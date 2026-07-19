import { Elysia } from "elysia";
import { config } from "./config.ts";
import { publicAuthRequestAllowed } from "./auth-protocol.ts";
import { json, routeError } from "./http.ts";
import { internalProxyRequest } from "./internal-proxy.ts";
import { securityHeaders } from "./security.ts";

function upstreamRequest(request: Request): Request {
  return internalProxyRequest(request, config.AUTH_AUTHORITY_URL, (headers) => {
    // The edge carries no credential. The authority independently reapplies
    // the public protocol allowlist and every route-specific auth policy.
    headers.delete("x-context-use-auth-edge");
  });
}

async function forward(request: Request): Promise<Response> {
  if (!publicAuthRequestAllowed(request)) {
    return new Response("Not found", { status: 404, headers: securityHeaders });
  }
  return fetch(upstreamRequest(request));
}

// This is the only authentication process reachable from Caddy. It has no
// database URL, signing secret, owner setup secret, pairwise private-service
// capability, or network route to dashboard/private MCP/confirmation.
export const authEdgeApp = new Elysia({ serve: { maxRequestBodySize: 3_100_000 } })
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/health", () => json({ status: "ok", service: "auth-edge" }))
  .all("/api/auth/*", ({ request }) => forward(request), { parse: "none" })
  .get("/.well-known/oauth-authorization-server", ({ request }) => forward(request))
  .get("/.well-known/openid-configuration", ({ request }) => forward(request));
