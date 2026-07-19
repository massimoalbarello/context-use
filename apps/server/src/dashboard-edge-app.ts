import { Elysia } from "elysia";
import { config } from "./config.ts";
import { json, routeError } from "./http.ts";
import { forwardInternalRequest } from "./internal-proxy.ts";
import { securityHeaders } from "./security.ts";

function allowed(request: Request): boolean {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/health") return request.method === "GET" || request.method === "HEAD";
  if (pathname.startsWith("/api/dashboard/")) return true;
  if (pathname === "/app" || pathname.startsWith("/app/") || pathname.startsWith("/assets/")) {
    return request.method === "GET" || request.method === "HEAD";
  }
  return false;
}

function forward(request: Request): Promise<Response> | Response {
  if (!allowed(request)) return new Response("Not found", { status: 404, headers: securityHeaders });
  return forwardInternalRequest(request, config.DASHBOARD_AUTHORITY_URL, (headers) => {
    // Browser input can never supply a pairwise service capability to the
    // credential-holding dashboard authority.
    headers.delete("x-context-use-auth-edge");
    headers.delete("x-context-use-dashboard-gateway");
  });
}

// Caddy reaches only this credentialless process. The private dashboard
// authority remains responsible for owner-session, origin, CSRF, and upload /
// download checks on every request that reaches its isolated network.
export const dashboardEdgeApp = new Elysia({ serve: { maxRequestBodySize: 5_100_000_000 } })
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/health", () => json({ status: "ok", service: "dashboard-edge" }))
  .all("/api/dashboard/*", ({ request }) => forward(request), { parse: "none" })
  .all("/api/health", ({ request }) => forward(request), { parse: "none" })
  .all("/app", ({ request }) => forward(request), { parse: "none" })
  .all("/app/*", ({ request }) => forward(request), { parse: "none" })
  .all("/assets/*", ({ request }) => forward(request), { parse: "none" });
