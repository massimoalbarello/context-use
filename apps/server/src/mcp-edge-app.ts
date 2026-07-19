import { Elysia } from "elysia";
import { config } from "./config.ts";
import { json, routeError } from "./http.ts";
import { forwardInternalRequest } from "./internal-proxy.ts";
import { securityHeaders } from "./security.ts";

const privateAssetPath = /^\/api\/mcp\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/content$/i;

function allowed(request: Request): boolean {
  const { pathname } = new URL(request.url);
  if (
    pathname === "/.well-known/oauth-protected-resource"
    || pathname === "/.well-known/oauth-protected-resource/mcp"
  ) return request.method === "GET" || request.method === "HEAD";
  if (pathname === "/mcp") return ["GET", "POST", "DELETE"].includes(request.method);
  if (privateAssetPath.test(pathname)) return request.method === "GET" || request.method === "PUT";
  return false;
}

function forward(request: Request): Promise<Response> | Response {
  if (!allowed(request)) return new Response("Not found", { status: 404, headers: securityHeaders });
  return forwardInternalRequest(request, config.MCP_AUTHORITY_URL, (headers) => {
    headers.delete("x-context-use-auth-edge");
    headers.delete("x-context-use-dashboard-gateway");
  });
}

// The public network terminates here. This process has no database, OAuth
// validation, storage, pairwise-service, signing, or AWS credential. The
// isolated MCP authority revalidates bearer scopes or the exact asset token.
export const mcpEdgeApp = new Elysia({ serve: { maxRequestBodySize: 5_100_000_000 } })
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/health", () => json({ status: "ok", service: "private-mcp-edge" }))
  .all("/.well-known/oauth-protected-resource", ({ request }) => forward(request), { parse: "none" })
  .all("/.well-known/oauth-protected-resource/mcp", ({ request }) => forward(request), { parse: "none" })
  .all("/mcp", ({ request }) => forward(request), { parse: "none" })
  .all("/api/mcp/assets/:id/content", ({ request }) => forward(request), { parse: "none" });
