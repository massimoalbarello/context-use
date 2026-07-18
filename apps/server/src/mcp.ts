import { AssetRepository, AutomationRepository, PageRepository } from "@context-use/database";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { authPool } from "./auth.ts";
import { config } from "./config.ts";
import { createMcpServer, type McpContext } from "./mcp-server.ts";
import { createStatelessMcpTransport, unsupportedMcpMethodResponse } from "./mcp-transport.ts";
import { ownerUserId } from "./owner.ts";
import type { ObjectStorage } from "./storage.ts";

function mcpUnauthorized(message: string): Response {
  return new Response(message, {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "www-authenticate": `Bearer resource_metadata="${config.APP_ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    },
  });
}

function scopesFromJwt(jwt: JWTPayload): Set<string> {
  const value = jwt.scope;
  if (typeof value === "string") return new Set(value.split(/\s+/).filter(Boolean));
  if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === "string"));
  const plural = jwt.scopes;
  return new Set(Array.isArray(plural) ? plural.filter((item): item is string => typeof item === "string") : []);
}

async function contextFromJwt(jwt: JWTPayload): Promise<McpContext | null> {
  const clientId = typeof jwt.azp === "string" ? jwt.azp : null;
  const userId = typeof jwt.sub === "string" ? jwt.sub : null;
  if (!clientId || !userId || jwt.principal_type !== "mcp_agent") return null;
  const scopes = scopesFromJwt(jwt);
  if (!(await isMcpGrantActive(clientId, userId, scopes))) return null;

  await authPool.query(
    `INSERT INTO mcp_client_usage(client_id,user_id,last_used_at) VALUES ($1,$2,now())
     ON CONFLICT (client_id,user_id) DO UPDATE SET last_used_at=excluded.last_used_at`,
    [clientId, userId],
  );
  return { clientId, userId, scopes };
}

export async function isMcpGrantActive(
  clientId: string,
  userId: string,
  scopes: ReadonlySet<string>,
): Promise<boolean> {
  const result = await authPool.query(
    `SELECT 1
     FROM "oauthClient" client
     JOIN "oauthConsent" consent ON consent."clientId"=client."clientId"
     JOIN "user" owner ON owner.id=consent."userId"
     WHERE client."clientId"=$1 AND consent."userId"=$2
       AND coalesce(client.disabled,false)=false
       AND owner.id=$3 AND lower(owner.email)=lower($4) AND owner."emailVerified"=true
       AND consent.scopes @> $5::jsonb`,
    [clientId, userId, ownerUserId, config.OWNER_EMAIL, JSON.stringify([...scopes])],
  );
  return Boolean(result.rowCount);
}

export function createMcpRequestHandler(
  pages: PageRepository,
  assets: AssetRepository,
  automations: AutomationRepository,
  storage: ObjectStorage,
) {
  const jwks = createRemoteJWKSet(new URL(`${config.APP_ORIGIN}/api/auth/jwks`));

  return async (request: Request): Promise<Response> => {
    if (request.headers.has("cookie")) return mcpUnauthorized("Cookie credentials are not accepted by MCP");
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
    if (!match) return mcpUnauthorized("Bearer authorization is required");
    let jwt: JWTPayload;
    try {
      const verified = await jwtVerify(match[1]!, jwks, {
        issuer: config.OAUTH_ISSUER,
        audience: config.MCP_RESOURCE,
        algorithms: ["EdDSA"],
      });
      jwt = verified.payload;
    } catch {
      return mcpUnauthorized("Bearer token is invalid or expired");
    }
    const audiences = typeof jwt.aud === "string" ? [jwt.aud] : jwt.aud;
    if (!audiences || audiences.length !== 1 || audiences[0] !== config.MCP_RESOURCE || typeof jwt.exp !== "number") {
      return mcpUnauthorized("Bearer token is not bound exclusively to this MCP resource");
    }
    const context = await contextFromJwt(jwt);
    if (!context) return mcpUnauthorized("OAuth grant is inactive");
    const unsupportedMethod = unsupportedMcpMethodResponse(request);
    if (unsupportedMethod) return unsupportedMethod;
    const transport = createStatelessMcpTransport();
    const server = createMcpServer(context, pages, assets, automations, storage);
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await transport.close();
      await server.close();
    }
  };
}
