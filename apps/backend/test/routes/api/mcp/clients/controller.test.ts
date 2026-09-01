import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { createMcpClientsController } from '#routes/api/mcp/clients/controller.ts';
import type { McpClientAuthorizationsServiceContract } from '#services/mcp-client-authorizations/service.ts';
import {
  testMcpServerUrl,
  unusedMcpClientAuthorizationsService,
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
