import { expect, test } from 'bun:test';
import type { Auth } from '#lib/auth/better-auth.ts';
import type { McpTransportContract } from '#lib/mcp/transport.ts';
import { createMcpController } from '#routes/mcp/controller.ts';
import type { McpConnectionsServiceContract } from '#services/mcp-connections/service.ts';
import { unusedMcpConnectionsService, unusedMcpTransport } from '../../support/mcp.ts';

const MILLISECONDS_PER_SECOND = 1_000;
const ACCESS_TOKEN_LIFETIME_SECONDS = 300;
const HTTP_NO_CONTENT = 204;
const HTTP_UNAUTHORIZED = 401;

test('an archived or revoked connection is rejected before the MCP transport', async () => {
  let transportCalls = 0;
  const auth = {
    handler: async () => new Response(null, { status: 404 }),
    getSession: async () => null,
    protectMcpRequest:
      ({ handler }) =>
      async (request) =>
        await handler({
          request,
          token: {
            ownerId: 'owner',
            oauthClientId: 'client',
            expiresAt:
              Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + ACCESS_TOKEN_LIFETIME_SECONDS,
            scopes: ['mcp'],
            token: 'access-token',
          },
        }),
  } satisfies Auth;
  const connectionsService = {
    ...unusedMcpConnectionsService,
    authenticate: () => Promise.resolve(null),
  } satisfies McpConnectionsServiceContract;
  const transport = {
    ...unusedMcpTransport,
    fetch: () => {
      transportCalls += 1;
      return Promise.resolve(new Response(null, { status: HTTP_NO_CONTENT }));
    },
  } satisfies McpTransportContract;

  const response = await createMcpController({ auth, connectionsService, transport }).handle(
    new Request('https://context.example/mcp', { method: 'POST' }),
  );

  expect(response.status).toBe(HTTP_UNAUTHORIZED);
  expect(response.headers.get('www-authenticate')).toContain(
    'resource_metadata="https://context.example/.well-known/oauth-protected-resource/mcp"',
  );
  expect(await response.json()).toMatchObject({
    jsonrpc: '2.0',
    error: { message: 'MCP connection is not active' },
  });
  expect(transportCalls).toBe(0);
});
