import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { McpConnectionsRepository } from '#repositories/mcp-connections/repository.ts';
import { McpConnectionsService } from '#services/mcp-connections/service.ts';
import { withAuthTestDatabase } from '../../lib/auth/auth-test-database.ts';

const EXPECTED_CONNECTION_COUNT = 3;
const EXPECTED_ACTIVE_CONNECTION_COUNT = 2;

async function insertOAuthClient({
  database,
  clientId,
  discovery,
}: {
  database: SQL;
  clientId: string;
  discovery: string | null;
}) {
  await database`
    insert into "auth_oauthClient"
      ("id", "clientId", "clientDiscoveryId", "name", "redirectUris")
    values
      (${`row-${clientId}`}, ${clientId}, ${discovery}, ${'Same reported name'}, ${'[]'})
  `;
}

test('active connection identity is stable per owner and OAuth client, never per friendly name', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      const now = new Date().toISOString();
      await database`
        insert into "auth_user"
          ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        values
          (${OWNER_USER_ID}, ${'Owner'}, ${'owner@example.invalid'}, ${true}, ${now}, ${now})
      `;
      await insertOAuthClient({ database, clientId: 'verified-client', discovery: 'cimd' });
      await insertOAuthClient({ database, clientId: 'fresh-client', discovery: null });

      const service = new McpConnectionsService(new McpConnectionsRepository(database));
      const verified = await service.authorizationClient({
        actorId: OWNER_USER_ID,
        clientId: 'verified-client',
      });
      expect(verified).toMatchObject({
        state: 'found',
        client: {
          clientId: 'verified-client',
          verifiedClientId: 'verified-client',
          suggestedName: 'Same reported name',
        },
      });
      expect(
        await service.authorizationClient({ actorId: OWNER_USER_ID, clientId: 'fresh-client' }),
      ).toMatchObject({
        state: 'found',
        client: { verifiedClientId: null, suggestedName: null },
      });

      const first = await service.approve({
        actorId: OWNER_USER_ID,
        clientId: 'verified-client',
        name: 'Shared friendly name',
      });
      expect(first.state).toBe('approved');
      if (first.state !== 'approved') {
        throw new Error('Expected first approval');
      }
      const reconnect = await service.approve({
        actorId: OWNER_USER_ID,
        clientId: 'verified-client',
        name: 'Renamed on reconnect',
      });
      expect(reconnect.state).toBe('approved');
      if (reconnect.state !== 'approved') {
        throw new Error('Expected reconnect approval');
      }
      expect(reconnect.connection.id).toBe(first.connection.id);
      expect(reconnect.connection.name).toBe('Renamed on reconnect');

      const similarName = await service.approve({
        actorId: OWNER_USER_ID,
        clientId: 'fresh-client',
        name: 'Renamed on reconnect',
      });
      expect(similarName.state).toBe('approved');
      if (similarName.state !== 'approved') {
        throw new Error('Expected second-client approval');
      }
      expect(similarName.connection.id).not.toBe(first.connection.id);
      expect(similarName.connection.verifiedClientId).toBeNull();

      expect(
        await service.archive({ actorId: OWNER_USER_ID, connectionId: first.connection.id }),
      ).toEqual({ state: 'archived' });
      const afterArchive = await service.approve({
        actorId: OWNER_USER_ID,
        clientId: 'verified-client',
        name: 'New approval',
      });
      expect(afterArchive.state).toBe('approved');
      if (afterArchive.state !== 'approved') {
        throw new Error('Expected approval after archive');
      }
      expect(afterArchive.connection.id).not.toBe(first.connection.id);

      const listed = await service.list({ actorId: OWNER_USER_ID });
      expect(listed.state).toBe('found');
      if (listed.state !== 'found') {
        throw new Error('Expected connection list');
      }
      expect(listed.connections).toHaveLength(EXPECTED_CONNECTION_COUNT);
      expect(listed.connections.filter(({ archivedAt }) => archivedAt === null)).toHaveLength(
        EXPECTED_ACTIVE_CONNECTION_COUNT,
      );
    },
  });
});
