import { expect, test } from 'bun:test';
import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { isUuidV7 } from '#models/syncs/model.ts';
import { RecordSyncsRepository } from '#repositories/syncs/repository.ts';
import { createRecordSyncsController } from '#routes/api/syncs/controller.ts';
import { RecordSyncsService } from '#services/syncs/service.ts';
import { withAuthTestDatabase } from '../../lib/auth/auth-test-database.ts';
import { unusedMcpProtection } from '../../support/mcp.ts';

const NOW = '2026-09-09T09:00:00.000Z';
const SYNC_ID = '01991f43-0c00-7000-8000-000000000040';
const API_KEY = '01991f43-0c00-7000-8000-000000000041';

function digest(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function ownerAuth(): Auth {
  const timestamp = new Date(NOW);
  return {
    handler: async () => new Response(null, { status: StatusMap['Not Found'] }),
    getSession: async () => ({
      user: {
        id: OWNER_USER_ID,
        name: 'Owner',
        email: OWNER_SYNTHETIC_EMAIL,
        emailVerified: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      session: {
        id: 'session-id',
        userId: OWNER_USER_ID,
        token: 'session-token',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    }),
    protectMcpRequest: unusedMcpProtection,
  };
}

test('sync API issues one UUIDv7 credential whose hash determines record provenance until revoked', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await database`
        insert into "auth_user"
          ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        values (${OWNER_USER_ID}, 'Owner', ${OWNER_SYNTHETIC_EMAIL}, 1, ${NOW}, ${NOW})
      `;
      const repository = new RecordSyncsRepository(database);
      const ids = [
        SYNC_ID,
        API_KEY,
        '01991f43-0c00-7000-8000-000000000042',
        '01991f43-0c00-7000-8000-000000000043',
      ];
      const service = new RecordSyncsService({
        syncs: repository,
        now: () => new Date(NOW),
        createUuidV7: () => ids.shift()!,
      });
      const app = new Elysia({ prefix: '/api' }).use(
        createRecordSyncsController({ auth: ownerAuth(), syncsService: service }),
      );

      const createResponse = await app.handle(
        new Request('http://localhost/api/syncs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Engineering activity' }),
        }),
      );
      expect(createResponse.status).toBe(StatusMap.Created);
      const created = (await createResponse.json()) as {
        apiKey: string;
        sync: { readableId: string; name: string; createdAt: string; revokedAt: null };
      };
      expect(created.apiKey).toBe(API_KEY);
      expect(isUuidV7(created.apiKey)).toBe(true);
      expect(created.sync).toEqual({
        readableId: expect.stringMatching(/^engineering-activity-[a-f0-9]{24}$/),
        name: 'Engineering activity',
        createdAt: NOW,
        revokedAt: null,
      });

      const stored = await database`
        select "api_key_sha256" as "apiKeySha256"
        from "record_sync"
        where "readable_id" = ${created.sync.readableId}
      `;
      expect(stored).toEqual([{ apiKeySha256: digest(API_KEY) }]);
      expect(JSON.stringify(stored)).not.toContain(API_KEY);
      expect(await service.authenticate({ apiKey: API_KEY })).toEqual({
        syncId: SYNC_ID,
        ownerId: OWNER_USER_ID,
      });

      const listResponse = await app.handle(new Request('http://localhost/api/syncs'));
      expect(listResponse.status).toBe(StatusMap.OK);
      const list = await listResponse.json();
      expect(list).toEqual({ items: [created.sync] });
      expect(JSON.stringify(list)).not.toContain(API_KEY);

      const duplicateNameResponse = await app.handle(
        new Request('http://localhost/api/syncs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Engineering activity' }),
        }),
      );
      expect(duplicateNameResponse.status).toBe(StatusMap.Conflict);

      const revokeResponse = await app.handle(
        new Request(`http://localhost/api/syncs/${created.sync.readableId}/revoke`, {
          method: 'PUT',
        }),
      );
      expect(revokeResponse.status).toBe(StatusMap['No Content']);
      expect(await service.authenticate({ apiKey: API_KEY })).toBeNull();

      const revokedListResponse = await app.handle(new Request('http://localhost/api/syncs'));
      expect(await revokedListResponse.json()).toEqual({
        items: [{ ...created.sync, revokedAt: NOW }],
      });
    },
  });
});
