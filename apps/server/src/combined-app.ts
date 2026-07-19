import { app as dashboardApp } from "./app.ts";
import { authApp } from "./auth-app.ts";
import { confirmationApp } from "./confirmation-app.ts";
import { mcpApp } from "./mcp-app.ts";
import { publicApp } from "./public-app.ts";

(globalThis as typeof globalThis & {
  __contextUseAuthHandler?: (request: Request) => Promise<Response> | Response;
  __contextUseConfirmationHandler?: (request: Request) => Promise<Response> | Response;
}).__contextUseAuthHandler = (request) => authApp.handle(request);
(globalThis as typeof globalThis & {
  __contextUseConfirmationHandler?: (request: Request) => Promise<Response> | Response;
}).__contextUseConfirmationHandler = (request) => confirmationApp.handle(request);

function target(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (
    path.startsWith("/api/auth/")
    || path === "/.well-known/oauth-authorization-server"
    || path === "/.well-known/openid-configuration"
    || path === "/api/dashboard/session"
    || path === "/api/dashboard/csrf"
    || path.startsWith("/api/dashboard/oauth-client")
  ) return authApp;
  if (
    path === "/api/dashboard/publications/confirm"
    || path === "/api/dashboard/knowledge-exports/confirm"
  ) return authApp;
  if (
    path === "/mcp"
    || path.startsWith("/api/mcp/")
    || path.startsWith("/.well-known/oauth-protected-resource")
  ) return mcpApp;
  if (path === "/" || path === "/public.css" || path === "/content.css" || path.startsWith("/p/")) return publicApp;
  return dashboardApp;
}

export const combinedApp = {
  handle(request: Request): Promise<Response> | Response {
    return target(request).handle(request);
  },
};
