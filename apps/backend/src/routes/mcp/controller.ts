import { Elysia } from 'elysia';
import { type Auth, MCP_ROUTE_PATH } from '#lib/auth/better-auth.ts';
import type { McpTransportContract } from '#lib/mcp/transport.ts';
import type { McpClientAuthorizationsServiceContract } from '#services/mcp-client-authorizations/service.ts';

function unauthorizedClientResponse(request: Request): Response {
  const resourceMetadata = new URL(
    `/.well-known/oauth-protected-resource${MCP_ROUTE_PATH}`,
    request.url,
  );
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32_001, message: 'MCP client is not authorized' },
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
  clientAuthorizationsService,
  transport,
}: {
  auth: Auth;
  clientAuthorizationsService: McpClientAuthorizationsServiceContract;
  transport: McpTransportContract;
}) {
  const protectedRequest = auth.protectMcpRequest({
    handler: async ({ request, token }) => {
      const principal = await clientAuthorizationsService.authenticate({
        ownerId: token.ownerId,
        oauthClientId: token.oauthClientId,
      });
      if (!principal) {
        return unauthorizedClientResponse(request);
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
