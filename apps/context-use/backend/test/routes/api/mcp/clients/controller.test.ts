import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createMcpClientsController } from '#backend/routes/api/mcp/clients/controller.ts';
import type { McpClientAuthorizationsServiceContract } from '#backend/services/mcp-client-authorizations/service.ts';
import {
  testMcpServerUrl,
  unusedMcpClientAuthorizationsService,
  unusedMcpProtection,
} from '../../../../support/mcp.ts';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const ownerAuth: Auth = {
  passkeyOrigins: [],
  handler: async () => new Response(null, { status: StatusMap['Not Found'] }),
  getSession: async () => ({
    user: {
      id: OWNER_USER_ID,
      name: 'Owner',
      email: OWNER_SYNTHETIC_EMAIL,
      emailVerified: true,
      createdAt,
      updatedAt: createdAt,
    },
    session: {
      id: 'session-id',
      userId: OWNER_USER_ID,
      token: 'session-token',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
    },
  }),
  protectMcpRequest: unusedMcpProtection,
};

test('client settings expose the configured public MCP server URL to the owner', async () => {
  const clientAuthorizationsService: McpClientAuthorizationsServiceContract = {
    ...unusedMcpClientAuthorizationsService,
    list: ({ actorId }) => {
      expect(actorId).toBe(OWNER_USER_ID);
      return Promise.resolve({ state: 'found', clientAuthorizations: [] });
    },
  };
  const response = await createMcpClientsController({
    auth: ownerAuth,
    clientAuthorizationsService,
    mcpServerUrl: testMcpServerUrl,
  }).handle(new Request('http://localhost/mcp/clients'));

  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual({ serverUrl: testMcpServerUrl, items: [] });
});

test('duplicate client names are returned as conflicts', async () => {
  const clientAuthorizationsService: McpClientAuthorizationsServiceContract = {
    ...unusedMcpClientAuthorizationsService,
    approve: () => Promise.resolve({ state: 'name_conflict' }),
    rename: () => Promise.resolve({ state: 'name_conflict' }),
  };
  const approval = await createMcpClientsController({
    auth: ownerAuth,
    clientAuthorizationsService,
    mcpServerUrl: testMcpServerUrl,
  }).handle(
    new Request('http://localhost/mcp/clients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 'oauth-client',
        name: 'Codex',
        changeMessage: 'Authorize Codex',
      }),
    }),
  );
  expect(approval.status).toBe(StatusMap.Conflict);
  expect(await approval.json()).toEqual({ error: 'An MCP client already uses this name' });

  const rename = await createMcpClientsController({
    auth: ownerAuth,
    clientAuthorizationsService,
    mcpServerUrl: testMcpServerUrl,
  }).handle(
    new Request('http://localhost/mcp/clients/client-authorization', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Codex', changeMessage: 'Rename MCP client' }),
    }),
  );
  expect({ status: rename.status, body: await rename.json() }).toEqual({
    status: StatusMap.Conflict,
    body: { error: 'An MCP client already uses this name' },
  });
});
