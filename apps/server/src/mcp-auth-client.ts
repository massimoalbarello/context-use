import {
  mcpClientHeader,
  mcpGatewayHeader,
  mcpSessionHeader,
} from "./auth-mcp-gateway.ts";
import { config } from "./config.ts";

async function authorize(headers: Record<string, string>): Promise<Response | null> {
  try {
    return await fetch(`${config.AUTH_INTERNAL_URL}/internal/authorize-mcp`, {
      headers: {
        ...headers,
        [mcpGatewayHeader]: config.AUTH_MCP_TOKEN,
      },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return null;
  }
}

export async function activeMcpClientId(token: string): Promise<string | null> {
  const response = await authorize({ authorization: `Bearer ${token}` });
  if (!response?.ok) return null;
  try {
    const body = await response.json() as { client_id?: unknown };
    return typeof body.client_id === "string" ? body.client_id : null;
  } catch {
    return null;
  }
}

export async function activeMcpLineage(clientId: string, sessionId: string): Promise<boolean> {
  const response = await authorize({
    [mcpClientHeader]: clientId,
    [mcpSessionHeader]: sessionId,
  });
  return response?.status === 204;
}
