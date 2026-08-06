import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { Elysia } from "elysia";
import { z } from "zod";
import {
  auth,
  authPathRequiresOwnerSession,
  authPool,
  dashboardPrincipal,
  ensureNangoOAuthClient,
  touchLiveOwnerSession,
} from "./auth.ts";
import { dashboardGatewayHeader } from "./auth-dashboard-gateway.ts";
import { publicAuthRequestAllowed } from "./auth-protocol.ts";
import { config, production } from "./config.ts";
import { forwardBrowserConfirmation } from "./confirmation-gateway.ts";
import { bodyJson, json, problem, routeError } from "./http.ts";
import { hasHeaderCapability, hasInternalCapability } from "./internal-capability.ts";
import { withCodexIssuerCompatibility } from "./oauth-metadata.ts";
import { ownerUserId } from "./owner.ts";
import { authorizePasskeyAuthRequest } from "./passkey-boundary.ts";
import { whilePasskeyOwnerLockHeld } from "./passkey-policy.ts";
import {
  authenticatorAttachmentSchema,
  confirmEnrollmentIntent,
  confirmRemovalIntent,
  createEnrollmentIntent,
  createRemovalIntent,
  managementIntentIdSchema,
  passkeyAssertionSchema,
  passkeyIdSchema,
  passkeyLabelSchema,
} from "./passkey-management.ts";
import {
  SecurityError,
  assertDashboardDownloadSecurity,
  assertDashboardRequestSecurity,
  assertDashboardUploadSecurity,
  csrfToken,
  requestMatchesOrigin,
  securityHeaders,
} from "./security.ts";
import { requireAuthenticationUserVerification } from "./webauthn-policy.ts";

const authServerMetadata = oauthProviderAuthServerMetadata(auth as never);
const openIdMetadata = oauthProviderOpenIdConfigMetadata(auth as never);
const internalHeaders = z.record(z.string(), z.string()).default({});
const internalAuthorization = z.object({
  method: z.string().min(1).max(12),
  pathname: z.string().startsWith("/").max(2_000),
  kind: z.enum(["read", "json", "upload", "download"]),
  headers: internalHeaders,
}).strict();
const clientPageNumber = z.coerce.number().int().min(1).default(1);
const clientPageSize = z.coerce.number().int().min(1).max(50).default(10);
const enrollmentIntentSchema = z.object({
  name: passkeyLabelSchema,
  authenticator_attachment: authenticatorAttachmentSchema,
}).strict();
const confirmationSchema = z.object({
  response: passkeyAssertionSchema,
}).strict();
const passkeyRemovalSchema = z.object({
  intent_id: managementIntentIdSchema,
  response: passkeyAssertionSchema,
}).strict();
const emptyObjectSchema = z.object({}).strict();
const nangoAccessTokenSchema = z.object({
  active: z.literal(true),
  azp: z.string(),
  client_id: z.string(),
  iss: z.string(),
  principal_type: z.literal("nango_dashboard_owner"),
  scope: z.string(),
  sid: z.string().min(1).max(512),
  sub: z.string(),
}).passthrough();

export const nangoGatewayHeader = "x-context-use-nango-gateway";

function bearerAccessToken(request: Request): string | null {
  return request.headers.get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9._~-]{32,8192})$/)?.[1] ?? null;
}

function exactNangoScopes(scope: string): boolean {
  const scopes = scope.split(" ").filter(Boolean);
  return scopes.length === 2 && new Set(scopes).size === 2
    && scopes.includes("openid") && scopes.includes("email");
}
function browserAuthRequest(request: Request, removeCookie = false): Request {
  const headers = new Headers(request.headers);
  if (removeCookie) headers.delete("cookie");
  return new Request(request, { headers });
}

async function ownerRequest(request: Request, mutation = false) {
  const fromDashboard = hasHeaderCapability(request, dashboardGatewayHeader, config.AUTH_DASHBOARD_TOKEN);
  if (production && config.SERVICE_MODE === "auth" && !fromDashboard) {
    throw new SecurityError("Not found", 404);
  }
  const browserRequest = fromDashboard
    ? new Request(new URL(`${new URL(request.url).pathname}${new URL(request.url).search}`, config.APP_ORIGIN), {
        method: request.method,
        headers: request.headers,
      })
    : request;
  if (!requestMatchesOrigin(browserRequest, config.APP_ORIGIN)) throw new SecurityError("Not found", 404);
  const principal = await dashboardPrincipal(browserRequest);
  if (!principal) throw new SecurityError("Dashboard session required", 401);
  if (mutation) assertDashboardRequestSecurity(browserRequest, principal);
  return principal;
}

export const authApp = new Elysia()
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/health", async () => {
    await ensureNangoOAuthClient();
    return json({ status: "ok", service: "auth" });
  })
  .all("/api/auth/*", async ({ request }) => {
    if (!publicAuthRequestAllowed(request)) return problem("Not found", 404, "not_found");
    await ensureNangoOAuthClient();
    const sanitized = browserAuthRequest(request);
    const pathname = new URL(sanitized.url).pathname;

    if (pathname === "/api/auth/get-session") {
      if (!await dashboardPrincipal(sanitized)) return json(null);
    } else if (pathname === "/api/auth/oauth2/authorize") {
      // Preserve Better Auth's normal unauthenticated login redirect, but never
      // let an idle/over-age cookie reach its OAuth authorization handler.
      if (!await dashboardPrincipal(sanitized)) {
        return auth.handler(browserAuthRequest(sanitized, true));
      }
    } else if (authPathRequiresOwnerSession(pathname) && !await dashboardPrincipal(sanitized)) {
      return problem("Owner session required", 401, "owner_session_required");
    }

    const boundary = await authorizePasskeyAuthRequest(sanitized);
    if (boundary.denied) return boundary.denied;
    return whilePasskeyOwnerLockHeld(
      async () => requireAuthenticationUserVerification(pathname, await auth.handler(sanitized)),
      boundary.release,
    );
  })
  .get("/.well-known/oauth-authorization-server", ({ request }) =>
    withCodexIssuerCompatibility(authServerMetadata(browserAuthRequest(request))))
  .get("/.well-known/openid-configuration", ({ request }) =>
    withCodexIssuerCompatibility(openIdMetadata(browserAuthRequest(request))))
  .post("/internal/authorize-dashboard", async ({ request }) => {
    if (!hasInternalCapability(request, config.AUTH_DASHBOARD_TOKEN)) return problem("Not found", 404, "not_found");
    const input = internalAuthorization.parse(await bodyJson(request));
    const reconstructed = new Request(`${config.APP_ORIGIN}${input.pathname}`, {
      method: input.method,
      headers: input.headers,
    });
    const principal = await dashboardPrincipal(reconstructed);
    if (!principal) return problem("Dashboard session required", 401, "unauthorized");
    if (input.kind === "json") assertDashboardRequestSecurity(reconstructed, principal);
    if (input.kind === "upload") assertDashboardUploadSecurity(reconstructed, principal);
    if (input.kind === "download") assertDashboardDownloadSecurity(reconstructed);
    return json(principal);
  })
  .get("/internal/authorize-nango", async ({ request }) => {
    if (!hasHeaderCapability(request, nangoGatewayHeader, config.AUTH_NANGO_TOKEN)) {
      return problem("Not found", 404, "not_found");
    }
    const token = bearerAccessToken(request);
    if (!token) return problem("Authorization required", 401, "unauthorized");
    await ensureNangoOAuthClient();

    let value: unknown;
    try {
      const oauthApi = auth.api as unknown as {
        oauth2Introspect(input: {
          asResponse: false;
          headers: Headers;
          request: Request;
          body: { token: string; token_type_hint: string };
        }): Promise<unknown>;
      };
      const headers = new Headers({
        authorization: `Basic ${Buffer.from(`${config.NANGO_OAUTH_CLIENT_ID}:${config.NANGO_OAUTH_CLIENT_SECRET}`).toString("base64")}`,
      });
      value = await oauthApi.oauth2Introspect({
        asResponse: false,
        headers,
        request: new Request(`${config.APP_ORIGIN}/api/auth/oauth2/introspect`, {
          method: "POST",
          headers,
        }),
        body: { token, token_type_hint: "access_token" },
      });
    } catch (error) {
      // The OAuth provider currently bundles its own APIError constructor, so
      // instanceof against Better Auth's public export is not stable across
      // package builds. Name matching is limited to this dependency boundary;
      // provider-side failures still remain distinguishable from bad tokens.
      if (error instanceof Error && error.name === "APIError") {
        const statusCode = Number((error as Error & { statusCode?: unknown }).statusCode);
        if (Number.isFinite(statusCode) && statusCode >= 500) {
          return problem("Authorization unavailable", 503, "authorization_unavailable");
        }
        return problem("Authorization required", 401, "unauthorized");
      }
      throw error;
    }

    const introspection = nangoAccessTokenSchema.safeParse(value);
    if (!introspection.success
        || introspection.data.client_id !== config.NANGO_OAUTH_CLIENT_ID
        || introspection.data.azp !== config.NANGO_OAUTH_CLIENT_ID
        || introspection.data.iss !== config.OAUTH_ISSUER
        || introspection.data.sub !== ownerUserId
        || !exactNangoScopes(introspection.data.scope)
        || !await touchLiveOwnerSession(introspection.data.sid)) {
      return problem("Authorization required", 401, "unauthorized");
    }
    return new Response(null, { status: 204, headers: securityHeaders });
  })
  .get("/internal/jwks", ({ request }) => {
    if (!hasInternalCapability(request, config.AUTH_MCP_TOKEN)) return problem("Not found", 404, "not_found");
    return auth.handler(new Request(`${config.APP_ORIGIN}/api/auth/jwks`));
  })
  .get("/api/dashboard/session", async ({ request }) => {
    const principal = await ownerRequest(request);
    const passkeys = await authPool.query<{
      id: string;
      name: string | null;
      createdAt: Date;
      deviceType: string;
      backedUp: boolean;
    }>(
      `SELECT id,name,"createdAt","deviceType","backedUp"
       FROM passkey WHERE "userId"=$1 ORDER BY "createdAt",id`,
      [principal.userId],
    );
    return json({
      owner: { id: principal.userId, email: principal.email },
      passkey_count: passkeys.rowCount,
      passkeys: passkeys.rows.map((key) => ({
        id: key.id,
        name: key.name,
        created_at: key.createdAt,
        device_type: key.deviceType,
        backed_up: key.backedUp,
      })),
    });
  })
  .get("/api/dashboard/csrf", async ({ request }) => {
    const principal = await ownerRequest(request);
    return json({ csrf_token: csrfToken(principal) });
  })
  .post("/api/dashboard/passkey-enrollment-intents", async ({ request }) => {
    const principal = await ownerRequest(request, true);
    const input = enrollmentIntentSchema.parse(await bodyJson(request));
    return json(await createEnrollmentIntent(
      authPool,
      principal,
      input.name,
      input.authenticator_attachment,
    ), 201);
  })
  .post("/api/dashboard/passkey-enrollment-intents/:id/confirm", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    const input = confirmationSchema.parse(await bodyJson(request));
    return json(await confirmEnrollmentIntent(
      authPool,
      principal,
      managementIntentIdSchema.parse(params.id),
      input.response,
    ));
  })
  .post("/api/dashboard/passkeys/:id/removal-intents", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    emptyObjectSchema.parse(await bodyJson(request));
    return json(await createRemovalIntent(
      authPool,
      principal,
      passkeyIdSchema.parse(params.id),
    ), 201);
  })
  .post("/api/dashboard/passkeys/:id/remove", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    const input = passkeyRemovalSchema.parse(await bodyJson(request));
    await confirmRemovalIntent(
      authPool,
      principal,
      input.intent_id,
      passkeyIdSchema.parse(params.id),
      input.response,
    );
    return json({ removed: true, sessions_revoked: true });
  })
  .post("/api/dashboard/publications/confirm", async ({ request }) => {
    const principal = await ownerRequest(request, true);
    return forwardBrowserConfirmation("publication", await bodyJson(request), principal);
  })
  .post("/api/dashboard/knowledge-exports/confirm", async ({ request }) => {
    const principal = await ownerRequest(request, true);
    return forwardBrowserConfirmation("knowledge_export", await bodyJson(request), principal);
  })
  .post("/api/dashboard/page-deletions/confirm", async ({ request }) => {
    const principal = await ownerRequest(request, true);
    return forwardBrowserConfirmation("page_deletion", await bodyJson(request), principal);
  })
  .get("/api/dashboard/private-mcp-clients", async ({ request, query }) => {
    const principal = await ownerRequest(request);
    const page = clientPageNumber.parse(query.page);
    const pageSize = clientPageSize.parse(query.page_size);
    const offset = (page - 1) * pageSize;
    const [clients, count] = await Promise.all([
      authPool.query(
        `SELECT client."clientId" AS client_id,client.name,client.uri,
                client."softwareVersion" AS version,client."createdAt" AS created_at,
                consent."updatedAt" AS approved_at,tokens.last_connected_at
         FROM "oauthConsent" consent
         JOIN "oauthClient" client ON client."clientId"=consent."clientId"
         LEFT JOIN (
           SELECT "clientId","userId",max("createdAt") AS last_connected_at
           FROM "oauthAccessToken"
           GROUP BY "clientId","userId"
         ) tokens ON tokens."clientId"=client."clientId" AND tokens."userId"=consent."userId"
         WHERE consent."userId"=$1
         ORDER BY coalesce(tokens.last_connected_at,consent."updatedAt") DESC,client."clientId" DESC
         LIMIT $2 OFFSET $3`,
        [principal.userId, pageSize, offset],
      ),
      authPool.query<{ total: string }>(
        `SELECT count(*) AS total FROM "oauthConsent" WHERE "userId"=$1`,
        [principal.userId],
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return json({
      items: clients.rows,
      page,
      page_size: pageSize,
      total,
      total_pages: Math.ceil(total / pageSize),
    });
  })
  .get("/api/dashboard/oauth-client-preview", async ({ request, query }) => {
    await ownerRequest(request);
    const clientId = z.string().min(1).max(512).parse(query.client_id);
    const result = await authPool.query(
      `SELECT "clientId" AS client_id,name,uri,"redirectUris" AS redirect_uris,
              "softwareId" AS software_id,"softwareVersion" AS software_version
       FROM "oauthClient" WHERE "clientId"=$1 AND coalesce(disabled,false)=false`,
      [clientId],
    );
    return result.rows[0] ? json(result.rows[0]) : problem("OAuth client not found", 404, "not_found");
  })
  .delete("/api/dashboard/oauth-clients/:clientId", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    const clientId = z.string().min(1).max(512).parse(params.clientId);
    const client = await authPool.connect();
    try {
      await client.query("BEGIN");
      const removed = await client.query(
        `DELETE FROM "oauthConsent" WHERE "clientId"=$1 AND "userId"=$2 RETURNING id`,
        [clientId, principal.userId],
      );
      if (!removed.rowCount) throw new SecurityError("Connected client not found", 404);
      await client.query(
        `UPDATE "oauthRefreshToken" SET revoked=now()
         WHERE "clientId"=$1 AND "userId"=$2 AND revoked IS NULL`,
        [clientId, principal.userId],
      );
      await client.query(
        `DELETE FROM "oauthAccessToken" WHERE "clientId"=$1 AND "userId"=$2`,
        [clientId, principal.userId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return json({ revoked: true });
  });
