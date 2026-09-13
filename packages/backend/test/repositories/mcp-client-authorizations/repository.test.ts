import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { McpClientAuthorizationsRepository } from '#repositories/mcp-client-authorizations/repository.ts';
import { McpClientAuthorizationsService } from '#services/mcp-client-authorizations/service.ts';
import { withAuthTestDatabase } from '../../lib/auth/auth-test-database.ts';

const EXPECTED_CLIENT_AUTHORIZATION_COUNT = 3;
const EXPECTED_ACTIVE_CLIENT_AUTHORIZATION_COUNT = 2;

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

test('client authorization identity is stable and its friendly name remains unique after archive', async () => {
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

      const service = new McpClientAuthorizationsService(
        new McpClientAuthorizationsRepository(database),
      );
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
      expect(reconnect.clientAuthorization.id).toBe(first.clientAuthorization.id);
      expect(reconnect.clientAuthorization.name).toBe('Renamed on reconnect');
      expect(reconnect.clientAuthorization.createdAt).toBe(first.clientAuthorization.createdAt);

      expect(
        await service.approve({
          actorId: OWNER_USER_ID,
          clientId: 'fresh-client',
          name: 'renamed on reconnect',
        }),
      ).toEqual({ state: 'name_conflict' });

      const fresh = await service.approve({
        actorId: OWNER_USER_ID,
        clientId: 'fresh-client',
        name: 'Fresh client',
      });
      expect(fresh.state).toBe('approved');
      if (fresh.state !== 'approved') {
        throw new Error('Expected second-client approval');
      }
      expect(fresh.clientAuthorization.id).not.toBe(first.clientAuthorization.id);
      expect(fresh.clientAuthorization.verifiedClientId).toBeNull();
      expect(
        await service.rename({
          actorId: OWNER_USER_ID,
          clientAuthorizationId: fresh.clientAuthorization.id,
          name: 'Renamed on reconnect',
        }),
      ).toEqual({ state: 'name_conflict' });

      expect(
        await service.archive({
          actorId: OWNER_USER_ID,
          clientAuthorizationId: first.clientAuthorization.id,
        }),
      ).toEqual({ state: 'archived' });
      expect(
        await service.rename({
          actorId: OWNER_USER_ID,
          clientAuthorizationId: first.clientAuthorization.id,
          name: 'Archived identities stay fixed',
        }),
      ).toEqual({ state: 'not_found' });
      expect(
        await service.rename({
          actorId: OWNER_USER_ID,
          clientAuthorizationId: fresh.clientAuthorization.id,
          name: 'Renamed on reconnect',
        }),
      ).toEqual({ state: 'name_conflict' });
      expect(
        await service.approve({
          actorId: OWNER_USER_ID,
          clientId: 'verified-client',
          name: 'renamed on reconnect',
        }),
      ).toEqual({ state: 'name_conflict' });
      const afterArchive = await service.approve({
        actorId: OWNER_USER_ID,
        clientId: 'verified-client',
        name: 'New approval',
      });
      expect(afterArchive.state).toBe('approved');
      if (afterArchive.state !== 'approved') {
        throw new Error('Expected approval after archive');
      }
      expect(afterArchive.clientAuthorization.id).not.toBe(first.clientAuthorization.id);

      const listed = await service.list({ actorId: OWNER_USER_ID });
      expect(listed.state).toBe('found');
      if (listed.state !== 'found') {
        throw new Error('Expected client authorization list');
      }
      expect(listed.clientAuthorizations).toHaveLength(EXPECTED_CLIENT_AUTHORIZATION_COUNT);
      expect(
        listed.clientAuthorizations.filter(({ archivedAt }) => archivedAt === null),
      ).toHaveLength(EXPECTED_ACTIVE_CLIENT_AUTHORIZATION_COUNT);
    },
  });
});
