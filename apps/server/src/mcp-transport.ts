import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export function unsupportedMcpMethodResponse(request: Request): Response | null {
  if (request.method === "POST") return null;
  return new Response(null, {
    status: 405,
    headers: { allow: "POST" },
  });
}

export function createStatelessMcpTransport(): WebStandardStreamableHTTPServerTransport {
  return new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
}
