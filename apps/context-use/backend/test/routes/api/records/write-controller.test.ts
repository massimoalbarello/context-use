import { expect, test } from 'bun:test';
import { Elysia, StatusMap } from 'elysia';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { ApiKeysRepository } from '#backend/repositories/api-keys/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { createRecordWriteController } from '#backend/routes/api/records/write-controller.ts';
import { ApiKeysService } from '#backend/services/api-keys/service.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { withRecordTestDatabase } from '../../../repositories/records/database.ts';

const NOW = '2026-09-09T09:00:00.000Z';
test('API keys and direct local writes share native identity; revocation cannot delete records', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${OWNER_USER_ID}, 'Owner', 'owner@example.invalid', 1, ${NOW}, ${NOW})`;
      const apiKeysService = new ApiKeysService({ keys: new ApiKeysRepository(database) });
      const recordsService = new RecordsService({
        records: new RecordsRepository(database),
        storage: createLocalStorage({ dataFolder }),
      });
      const app = new Elysia({ prefix: '/api' })
        .onError(elysiaErrorHandler)
        .use(createRecordWriteController({ apiKeysService, recordsService }));
      const firstKey = await apiKeysService.create({
        actorId: OWNER_USER_ID,
        name: 'First sender',
      });
      const secondKey = await apiKeysService.create({
        actorId: OWNER_USER_ID,
        name: 'Second sender',
      });
      if (firstKey.state !== 'created' || secondKey.state !== 'created') {
        throw new Error('Expected keys');
      }
      const record = {
        source: { provider: 'github', kind: 'pull-request', id: 'PR_42' },
        title: 'PR title',
        body: '# Evidence',
        occurredAt: NOW,
        sourceUpdatedAt: NOW,
      };
      const local = await recordsService.upsert({ ownerId: OWNER_USER_ID, record });
      const post = ({ key, body = record }: { key: string | null; body?: unknown }) =>
        app.handle(
          new Request('http://localhost/api/records', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(key ? { authorization: `Bearer ${key}` } : {}),
            },
            body: JSON.stringify(body),
          }),
        );
      for (const key of [firstKey.apiKey, secondKey.apiKey]) {
        const response = await post({ key });
        expect(response.status).toBe(StatusMap.OK);
        expect(await response.json()).toEqual({ state: 'unchanged', readableId: local.readableId });
      }
      expect((await post({ key: null })).status).toBe(StatusMap.Unauthorized);
      expect((await post({ key: 'invalid' })).status).toBe(StatusMap.Unauthorized);
      expect(
        (await post({ key: firstKey.apiKey, body: { ...record, ownerId: 'someone-else' } })).status,
      ).toBe(StatusMap['Bad Request']);
      expect(
        (await post({ key: firstKey.apiKey, body: { ...record, body: 'Conflicting' } })).status,
      ).toBe(StatusMap.Conflict);
      const changed = { ...record, body: 'Updated', sourceUpdatedAt: '2026-09-10T09:00:00.000Z' };
      expect(await (await post({ key: secondKey.apiKey, body: changed })).json()).toEqual({
        state: 'updated',
        readableId: local.readableId,
      });
      expect(await (await post({ key: firstKey.apiKey })).json()).toEqual({
        state: 'stale',
        readableId: local.readableId,
      });
      await apiKeysService.revoke({ actorId: OWNER_USER_ID, readableId: firstKey.key.readableId });
      expect((await post({ key: firstKey.apiKey })).status).toBe(StatusMap.Unauthorized);
      expect((await post({ key: secondKey.apiKey, body: changed })).status).toBe(StatusMap.OK);
      expect(
        (await recordsService.listResources({ ownerId: OWNER_USER_ID, limit: 10, offset: 0 }))
          .items,
      ).toHaveLength(1);
      expect(
        (
          await recordsService.findResource({
            ownerId: OWNER_USER_ID,
            readableId: local.readableId,
          })
        )?.body,
      ).toBe('Updated');
    },
  });
});
