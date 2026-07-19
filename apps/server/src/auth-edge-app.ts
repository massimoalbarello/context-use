import { Elysia } from "elysia";
import { config } from "./config.ts";
import { publicAuthRequestAllowed } from "./auth-protocol.ts";
import { json, routeError } from "./http.ts";
import { securityHeaders } from "./security.ts";

const AUTH_EDGE_HEADER = "x-context-use-auth-edge";

function upstreamRequest(request: Request): Request {
  const incoming = new URL(request.url);
  const upstream = new URL(`${incoming.pathname}${incoming.search}`, config.AUTH_AUTHORITY_URL);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("transfer-encoding");
  // Never trust a caller-supplied ingress capability.
  headers.set(AUTH_EDGE_HEADER, config.AUTH_EDGE_TOKEN);
  return new Request(upstream, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
    redirect: "manual",
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
