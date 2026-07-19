import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { MCP_SCOPES } from "@context-use/shared";
import { Elysia } from "elysia";
import { z } from "zod";
import { auth, authPool, dashboardPrincipal } from "./auth.ts";
import { config } from "./config.ts";
import { forwardBrowserConfirmation } from "./confirmation-gateway.ts";
import { bodyJson, json, problem, routeError } from "./http.ts";
import { hasInternalCapability } from "./internal-capability.ts";
import { withCodexIssuerCompatibility } from "./oauth-metadata.ts";
import { ownerUserId } from "./owner.ts";
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
const grantSchema = z.object({
  clientId: z.string().min(1).max(512),
  userId: z.string().min(1).max(512),
  scopes: z.array(z.string().min(1).max(128)).max(64),
}).strict();

async function ownerRequest(request: Request, mutation = false) {
  if (!requestMatchesOrigin(request, config.APP_ORIGIN)) throw new SecurityError("Not found", 404);
  const principal = await dashboardPrincipal(request);
  if (!principal) throw new SecurityError("Dashboard session required", 401);
  if (mutation) assertDashboardRequestSecurity(request, principal);
  return principal;
}

export const authApp = new Elysia()
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/health", () => json({ status: "ok", service: "auth" }))
  .all("/api/auth/*", async ({ request }) => {
    const boundary = await authorizePasskeyAuthRequest(request);
    if (boundary.denied) return boundary.denied;
    try {
      const pathname = new URL(request.url).pathname;
      return await requireAuthenticationUserVerification(pathname, await auth.handler(request));
    } finally {
      await boundary.release?.();
    }
  })
  .get("/.well-known/oauth-authorization-server", ({ request }) => (
    withCodexIssuerCompatibility(authServerMetadata(request))
  ))
  .get("/.well-known/openid-configuration", ({ request }) => (
    withCodexIssuerCompatibility(openIdMetadata(request))
  ))
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
  .post("/internal/validate-mcp-grant", async ({ request }) => {
    if (!hasInternalCapability(request, config.AUTH_MCP_TOKEN)) return problem("Not found", 404, "not_found");
    const input = grantSchema.parse(await bodyJson(request));
    const result = await authPool.query(
      `SELECT 1
       FROM "oauthClient" client
       JOIN "oauthConsent" consent ON consent."clientId"=client."clientId"
       JOIN "user" owner ON owner.id=consent."userId"
       WHERE client."clientId"=$1 AND consent."userId"=$2
         AND coalesce(client.disabled,false)=false
         AND owner.id=$3 AND lower(owner.email)=lower($4) AND owner."emailVerified"=true
         AND consent.scopes @> $5::jsonb`,
      [input.clientId, input.userId, ownerUserId, config.OWNER_EMAIL, JSON.stringify(input.scopes)],
    );
    if (result.rowCount) {
      await authPool.query(
        `INSERT INTO mcp_client_usage(client_id,user_id,last_used_at) VALUES ($1,$2,now())
         ON CONFLICT (client_id,user_id) DO UPDATE SET last_used_at=excluded.last_used_at`,
        [input.clientId, input.userId],
      );
    }
    return json({ active: Boolean(result.rowCount) });
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
  .get("/api/dashboard/oauth-clients", async ({ request }) => {
    const principal = await ownerRequest(request);
    const result = await authPool.query(
      `SELECT client."clientId" AS client_id,client.name,client.uri,client."createdAt" AS created_at,
              consent.scopes,consent."updatedAt" AS approved_at,usage.last_used_at
       FROM "oauthConsent" consent
       JOIN "oauthClient" client ON client."clientId"=consent."clientId"
       LEFT JOIN mcp_client_usage usage ON usage.client_id=client."clientId" AND usage.user_id=consent."userId"
       WHERE consent."userId"=$1
       ORDER BY consent."updatedAt" DESC`,
      [principal.userId],
    );
    return json(result.rows);
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
  })
  .get("/.well-known/oauth-protected-resource", () => json({
    resource: config.MCP_RESOURCE,
    authorization_servers: [config.OAUTH_ISSUER],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "context-use personal knowledge base",
  }));
