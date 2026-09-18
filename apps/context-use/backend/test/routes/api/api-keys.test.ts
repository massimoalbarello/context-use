import { expect, test } from 'bun:test';
import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { isUuidV7 } from '#backend/models/api-keys/model.ts';
import { ApiKeysRepository } from '#backend/repositories/api-keys/repository.ts';
import { createApiKeysController } from '#backend/routes/api/api-keys/controller.ts';
import { ApiKeysService } from '#backend/services/api-keys/service.ts';
import { withAuthTestDatabase } from '../../lib/auth/auth-test-database.ts';
import { unusedMcpProtection } from '../../support/mcp.ts';

const NOW = '2026-09-09T09:00:00.000Z';
const API_KEY_ID = '01991f43-0c00-7000-8000-000000000040';
const API_KEY = '01991f43-0c00-7000-8000-000000000041';

function digest(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function ownerAuth(): Auth {
  const timestamp = new Date(NOW);
  return {
    passkeyOrigins: [],
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

test('API key issuance stores only its hash and revocation removes authorization', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await database`
        insert into "auth_user"
          ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        values (${OWNER_USER_ID}, 'Owner', ${OWNER_SYNTHETIC_EMAIL}, 1, ${NOW}, ${NOW})
      `;
      const repository = new ApiKeysRepository(database);
      const ids = [
        API_KEY_ID,
        API_KEY,
        '01991f43-0c00-7000-8000-000000000042',
        '01991f43-0c00-7000-8000-000000000043',
      ];
      const service = new ApiKeysService({
        keys: repository,
        now: () => new Date(NOW),
        createUuidV7: () => ids.shift()!,
      });
      const app = new Elysia({ prefix: '/api' }).use(
        createApiKeysController({ auth: ownerAuth(), apiKeysService: service }),
      );

      const createResponse = await app.handle(
        new Request('http://localhost/api/api-keys', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Engineering activity' }),
        }),
      );
      expect(createResponse.status).toBe(StatusMap.Created);
      const created = (await createResponse.json()) as {
        apiKey: string;
        key: { readableId: string; name: string; createdAt: string; revokedAt: null };
      };
      expect(created.apiKey).toBe(API_KEY);
      expect(isUuidV7(created.apiKey)).toBe(true);
      expect(created.key).toEqual({
        readableId: expect.stringMatching(/^engineering-activity-[a-f0-9]{24}$/),
        name: 'Engineering activity',
        createdAt: NOW,
        revokedAt: null,
      });

      const stored = await database`
        select "api_key_sha256" as "apiKeySha256"
        from "api_key"
        where "readable_id" = ${created.key.readableId}
      `;
      expect(stored).toEqual([{ apiKeySha256: digest(API_KEY) }]);
      expect(JSON.stringify(stored)).not.toContain(API_KEY);
      expect(await service.authenticate({ apiKey: API_KEY })).toEqual({
        keyId: API_KEY_ID,
        ownerId: OWNER_USER_ID,
      });

      const listResponse = await app.handle(new Request('http://localhost/api/api-keys'));
      expect(listResponse.status).toBe(StatusMap.OK);
      const list = await listResponse.json();
      expect(list).toEqual({ items: [created.key] });
      expect(JSON.stringify(list)).not.toContain(API_KEY);

      const duplicateNameResponse = await app.handle(
        new Request('http://localhost/api/api-keys', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Engineering activity' }),
        }),
      );
      expect(duplicateNameResponse.status).toBe(StatusMap.Conflict);

      const revokeResponse = await app.handle(
        new Request(`http://localhost/api/api-keys/${created.key.readableId}/revoke`, {
          method: 'PUT',
        }),
      );
      expect(revokeResponse.status).toBe(StatusMap['No Content']);
      expect(await service.authenticate({ apiKey: API_KEY })).toBeNull();

      const revokedListResponse = await app.handle(new Request('http://localhost/api/api-keys'));
      expect(await revokedListResponse.json()).toEqual({
        items: [{ ...created.key, revokedAt: NOW }],
      });
    },
  });
});
