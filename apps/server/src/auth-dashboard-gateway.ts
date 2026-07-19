import { config } from "./config.ts";
import { internalProxyRequest } from "./internal-proxy.ts";

const dashboardGatewayHeader = "x-context-use-dashboard-gateway";

export async function forwardDashboardAuthRoute(request: Request): Promise<Response> {
  const internalRequest = internalProxyRequest(request, config.AUTH_INTERNAL_URL, (headers) => {
    headers.set(dashboardGatewayHeader, config.AUTH_DASHBOARD_TOKEN);
  });
  const local = (globalThis as typeof globalThis & {
    __contextUseAuthHandler?: (request: Request) => Promise<Response> | Response;
  }).__contextUseAuthHandler;
  return local ? local(internalRequest) : fetch(internalRequest);
}

export { dashboardGatewayHeader };
