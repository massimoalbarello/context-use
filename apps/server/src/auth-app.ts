import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { Elysia } from "elysia";
import { z } from "zod";
import { auth, authPathRequiresOwnerSession, authPool, dashboardPrincipal } from "./auth.ts";
import { dashboardGatewayHeader } from "./auth-dashboard-gateway.ts";
import { publicAuthRequestAllowed } from "./auth-protocol.ts";
import { config, production } from "./config.ts";
import { forwardBrowserConfirmation } from "./confirmation-gateway.ts";
import { bodyJson, json, problem, routeError } from "./http.ts";
import { hasHeaderCapability, hasInternalCapability } from "./internal-capability.ts";
import { withCodexIssuerCompatibility } from "./oauth-metadata.ts";
import { authorizePasskeyAuthRequest } from "./passkey-boundary.ts";
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
  .get("/health", () => json({ status: "ok", service: "auth" }))
  .all("/api/auth/*", async ({ request }) => {
    if (!publicAuthRequestAllowed(request)) return problem("Not found", 404, "not_found");
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
    try {
      return await requireAuthenticationUserVerification(pathname, await auth.handler(sanitized));
    } finally {
      await boundary.release?.();
    }
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
  .get("/internal/jwks", ({ request }) => {
    if (!hasInternalCapability(request, config.AUTH_MCP_TOKEN)) return problem("Not found", 404, "not_found");
    return auth.handler(new Request(`${config.APP_ORIGIN}/api/auth/jwks`));
  })
  .get("/api/dashboard/session", async ({ request }) => {
    const principal = await ownerRequest(request);
    const passkeys = await authPool.query<{ id: string; name: string | null; createdAt: Date }>(
      `SELECT id,name,"createdAt" FROM passkey WHERE "userId"=$1 ORDER BY "createdAt"`,
      [principal.userId],
    );
    return json({
      owner: { id: principal.userId, email: principal.email },
      passkey_count: passkeys.rowCount,
      passkeys: passkeys.rows.map((key) => ({ id: key.id, name: key.name, created_at: key.createdAt })),
    });
  })
  .get("/api/dashboard/csrf", async ({ request }) => {
    const principal = await ownerRequest(request);
    return json({ csrf_token: csrfToken(principal) });
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
