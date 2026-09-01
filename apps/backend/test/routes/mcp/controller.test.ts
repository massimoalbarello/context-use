import { expect, test } from 'bun:test';
import type { Auth } from '#lib/auth/better-auth.ts';
import type { McpTransportContract } from '#lib/mcp/transport.ts';
import { createMcpController } from '#routes/mcp/controller.ts';
import type { McpClientAuthorizationsServiceContract } from '#services/mcp-client-authorizations/service.ts';
import { unusedMcpClientAuthorizationsService, unusedMcpTransport } from '../../support/mcp.ts';

const MILLISECONDS_PER_SECOND = 1_000;
const ACCESS_TOKEN_LIFETIME_SECONDS = 300;
const HTTP_NOT_FOUND = 404;
const HTTP_NO_CONTENT = 204;
const HTTP_UNAUTHORIZED = 401;

test('an archived or revoked client authorization is rejected before the MCP transport', async () => {
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
            resource: new URL('https://context.example/mcp'),
            scopes: ['mcp'],
            token: 'access-token',
          },
        }),
  } satisfies Auth;
  const clientAuthorizationsService = {
    ...unusedMcpClientAuthorizationsService,
    authenticate: () => Promise.resolve(null),
  } satisfies McpClientAuthorizationsServiceContract;
  const transport = {
    ...unusedMcpTransport,
    fetch: () => {
      transportCalls += 1;
      return Promise.resolve(new Response(null, { status: HTTP_NO_CONTENT }));
    },
  } satisfies McpTransportContract;

  const controller = createMcpController({
    auth,
    clientAuthorizationsService,
    transport,
  });
  const response = await controller.handle(
    new Request('https://internal-proxy.invalid/mcp', { method: 'POST' }),
  );

  expect(response.status).toBe(HTTP_UNAUTHORIZED);
  expect(response.headers.get('www-authenticate')).toContain(
    'resource_metadata="https://context.example/.well-known/oauth-protected-resource/mcp"',
  );
  expect(await response.json()).toMatchObject({
    jsonrpc: '2.0',
    error: { message: 'MCP client is not authorized' },
  });
  expect(transportCalls).toBe(0);

  const nonPostResponse = await controller.handle(new Request('https://context.example/mcp'));
  expect(nonPostResponse.status).toBe(HTTP_NOT_FOUND);
});

test('the authenticated owner and stable client authorization identity reach the MCP transport', async () => {
  const principal = {
    ownerId: 'owner',
    clientAuthorizationId: 'client-authorization',
    clientAuthorizationName: 'Research agent',
  };
  const auth = {
    handler: async () => new Response(null, { status: 404 }),
    getSession: async () => null,
    protectMcpRequest:
      ({ handler }) =>
      async (request) =>
        await handler({
          request,
          token: {
            ownerId: principal.ownerId,
            oauthClientId: 'oauth-client',
            expiresAt:
              Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + ACCESS_TOKEN_LIFETIME_SECONDS,
            resource: new URL('https://context.example/mcp'),
            scopes: ['mcp'],
            token: 'access-token',
          },
        }),
  } satisfies Auth;
  const clientAuthorizationsService = {
    ...unusedMcpClientAuthorizationsService,
    authenticate: (input) => {
      expect(input).toEqual({ ownerId: principal.ownerId, oauthClientId: 'oauth-client' });
      return Promise.resolve(principal);
    },
  } satisfies McpClientAuthorizationsServiceContract;
  const transport = {
    ...unusedMcpTransport,
    fetch: (input) => {
      expect(input.principal).toEqual(principal);
      expect(input.accessToken).toBe('access-token');
      expect(input.resource.href).toBe('https://context.example/mcp');
      return Promise.resolve(new Response(null, { status: HTTP_NO_CONTENT }));
    },
  } satisfies McpTransportContract;

  const response = await createMcpController({
    auth,
    clientAuthorizationsService,
    transport,
  }).handle(new Request('https://context.example/mcp', { method: 'POST' }));

  expect(response.status).toBe(HTTP_NO_CONTENT);
});
