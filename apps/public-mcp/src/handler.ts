import type { PublicPageReader } from "./mcp-server.ts";
import { createPublicMcpServer } from "./mcp-server.ts";
import { createPublicMcpTransport } from "./transport.ts";

const securityHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function response(body: BodyInit | null, status: number, headers: HeadersInit = {}): Response {
  return new Response(body, { status, headers: { ...securityHeaders, ...headers } });
}

export function createPublicMcpRequestHandler(
  reader: PublicPageReader,
  endpoint: URL,
  publicSiteOrigin: string,
) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname !== endpoint.pathname) return response("Not found", 404);
    if (request.method !== "POST") return response(null, 405, { allow: "POST" });
    if (request.headers.has("authorization") || request.headers.has("cookie")) {
      return response("Credentials are not accepted by the public MCP server", 400);
    }
    const origin = request.headers.get("origin");
    if (origin && origin !== endpoint.origin) return response("Untrusted origin", 403);

    const transport = createPublicMcpTransport();
    const server = createPublicMcpServer(reader, publicSiteOrigin);
    try {
      await server.connect(transport);
      const handled = await transport.handleRequest(request);
      const headers = new Headers(handled.headers);
      for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
      return new Response(handled.body, { status: handled.status, headers });
    } catch (error) {
      console.error("public_mcp_request_failed", {
        error_type: error instanceof Error ? error.name : typeof error,
      });
      return response("Internal server error", 500);
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  };
}
