import { z } from "zod";
import { config } from "./config.ts";

export type DashboardPrincipal = { userId: string; sessionId: string; email: string };
export type DashboardAuthorizationKind = "read" | "json" | "upload" | "download";

const principalSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  email: z.string().email(),
}).strict();

function forwardedHeaders(request: Request): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of [
    "authorization", "cookie", "origin", "sec-fetch-site", "x-csrf-token",
    "content-type", "x-forwarded-proto",
  ]) {
    const value = request.headers.get(name);
    if (value !== null) result[name] = value;
  }
  return result;
}

export async function authorizeDashboardRequest(
  request: Request,
  kind: DashboardAuthorizationKind,
): Promise<DashboardPrincipal | null> {
  const endpoint = config.AUTH_INTERNAL_URL;
  const internalRequest = new Request(`${endpoint}/internal/authorize-dashboard`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.AUTH_DASHBOARD_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      method: request.method,
      pathname: new URL(request.url).pathname,
      kind,
      headers: forwardedHeaders(request),
    }),
  });
  const local = (globalThis as typeof globalThis & {
    __contextUseAuthHandler?: (request: Request) => Promise<Response> | Response;
  }).__contextUseAuthHandler;
  const response = local ? await local(internalRequest) : await fetch(internalRequest);
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Authentication service rejected authorization (${response.status})`);
  return principalSchema.parse(await response.json());
}

export async function validateMcpGrant(input: {
  clientId: string;
  userId: string;
  scopes: string[];
}): Promise<boolean> {
  const endpoint = config.AUTH_INTERNAL_URL;
  const internalRequest = new Request(`${endpoint}/internal/validate-mcp-grant`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.AUTH_MCP_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const local = (globalThis as typeof globalThis & {
    __contextUseAuthHandler?: (request: Request) => Promise<Response> | Response;
  }).__contextUseAuthHandler;
  const response = local ? await local(internalRequest) : await fetch(internalRequest);
  if (!response.ok) return false;
  return (await response.json() as { active?: boolean }).active === true;
}
