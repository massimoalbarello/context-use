import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { createMcpConnectionsController } from '#routes/api/mcp/connections/controller.ts';
import type { McpConnectionsServiceContract } from '#services/mcp-connections/service.ts';
import {
  testMcpServerUrl,
  unusedMcpConnectionsService,
  unusedMcpProtection,
} from '../../../../support/mcp.ts';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const ownerAuth: Auth = {
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

test('connection settings expose the configured public MCP server URL to the owner', async () => {
  const connectionsService: McpConnectionsServiceContract = {
    ...unusedMcpConnectionsService,
    list: ({ actorId }) => {
      expect(actorId).toBe(OWNER_USER_ID);
      return Promise.resolve({ state: 'found', connections: [] });
    },
  };
  const response = await createMcpConnectionsController({
    auth: ownerAuth,
    connectionsService,
    mcpServerUrl: testMcpServerUrl,
  }).handle(new Request('http://localhost/mcp/connections'));

  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual({ serverUrl: testMcpServerUrl, items: [] });
});
