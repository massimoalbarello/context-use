import { AssetRepository, AutomationRepository, PageRepository } from "@context-use/database";
import { MCP_SCOPE } from "@context-use/shared";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "./config.ts";
import { createMcpServer, type McpContext } from "./mcp-server.ts";
import { createStatelessMcpTransport, unsupportedMcpMethodResponse } from "./mcp-transport.ts";
import { requestMatchesOrigin } from "./security.ts";

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

function contextFromJwt(jwt: JWTPayload): McpContext | null {
  const clientId = typeof jwt.azp === "string" ? jwt.azp : null;
  const userId = typeof jwt.sub === "string" ? jwt.sub : null;
  if (!clientId || !userId || jwt.principal_type !== "mcp_agent") return null;
  const scopes = scopesFromJwt(jwt);
  if (!scopes.has(MCP_SCOPE)) return null;
  return { clientId };
}

export function createMcpRequestHandler(
  pages: PageRepository,
  assets: AssetRepository,
  automations: AutomationRepository,
) {
  // Fetch keys over the private service network. The token issuer and audience
  // remain the public canonical URLs, but the isolated MCP container does not
  // need internet access merely to validate a signature.
  const jwks = createRemoteJWKSet(new URL(`${config.AUTH_INTERNAL_URL}/internal/jwks`), {
    headers: { authorization: `Bearer ${config.AUTH_MCP_TOKEN}` },
  });

  return async (request: Request): Promise<Response> => {
    if (!requestMatchesOrigin(request, config.APP_ORIGIN)) {
      return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
    }
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
    const context = contextFromJwt(jwt);
    if (!context) return mcpUnauthorized(`Bearer token lacks ${MCP_SCOPE}`);
    const unsupportedMethod = unsupportedMcpMethodResponse(request);
    if (unsupportedMethod) return unsupportedMethod;
    const transport = createStatelessMcpTransport();
    const server = createMcpServer(context, pages, assets, automations);
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await transport.close();
      await server.close();
    }
  };
}
