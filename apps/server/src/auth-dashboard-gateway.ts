import { config } from "./config.ts";

const dashboardGatewayHeader = "x-context-use-dashboard-gateway";

export async function forwardDashboardAuthRoute(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const upstream = new URL(`${incoming.pathname}${incoming.search}`, config.AUTH_INTERNAL_URL);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("transfer-encoding");
  headers.set(dashboardGatewayHeader, config.AUTH_DASHBOARD_TOKEN);
  const internalRequest = new Request(upstream, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
    redirect: "manual",
  });
  const local = (globalThis as typeof globalThis & {
    __contextUseAuthHandler?: (request: Request) => Promise<Response> | Response;
  }).__contextUseAuthHandler;
  return local ? local(internalRequest) : fetch(internalRequest);
}

export { dashboardGatewayHeader };
