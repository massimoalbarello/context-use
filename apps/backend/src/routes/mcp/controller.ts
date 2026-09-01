import { Elysia } from 'elysia';
import { type Auth, MCP_ROUTE_PATH } from '#lib/auth/better-auth.ts';
import type { McpTransportContract } from '#lib/mcp/transport.ts';
import type { McpConnectionsServiceContract } from '#services/mcp-connections/service.ts';

function inactiveConnectionResponse(request: Request): Response {
  const resourceMetadata = new URL(
    `/.well-known/oauth-protected-resource${MCP_ROUTE_PATH}`,
    request.url,
  );
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32_001, message: 'MCP connection is not active' },
      id: null,
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': `Bearer error="invalid_token", resource_metadata="${resourceMetadata.href}"`,
      },
    },
  );
}

export function createMcpController({
  auth,
  connectionsService,
  transport,
}: {
  auth: Auth;
  connectionsService: McpConnectionsServiceContract;
  transport: McpTransportContract;
}) {
  const protectedRequest = auth.protectMcpRequest({
    handler: async ({ request, token }) => {
      const principal = await connectionsService.authenticate({
        ownerId: token.ownerId,
        oauthClientId: token.oauthClientId,
      });
      if (!principal) {
        return inactiveConnectionResponse(request);
      }
      return await transport.fetch({
        request,
        accessToken: token.token,
        oauthClientId: token.oauthClientId,
        scopes: token.scopes,
        expiresAt: token.expiresAt,
        principal,
      });
    },
  });

  return new Elysia().all(MCP_ROUTE_PATH, ({ request }) => protectedRequest(request), {
    parse: 'none',
    detail: { hide: true },
  });
}
