import { expect, test } from 'bun:test';
import { Elysia, StatusMap } from 'elysia';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { ApiKeysRepository } from '#backend/repositories/api-keys/repository.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { HistoryRepository } from '#backend/repositories/history/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { createRecordWriteController } from '#backend/routes/api/records/write-controller.ts';
import { McpAssetSchema, mcpAsset } from '#backend/routes/mcp/assets/model.ts';
import { ApiKeysService } from '#backend/services/api-keys/service.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { withRecordTestDatabase } from '../../../repositories/records/database.ts';
import { unusedAssetFacesService } from '../../../support/app.ts';

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
        sourceUpdatedAt: NOW,
      };
      const local = await recordsService.upsert({
        change: { clientName: null, message: 'Updated test context' },
        ownerId: OWNER_USER_ID,
        record,
      });
      const post = ({ key, body = record }: { key: string | null; body?: unknown }) =>
        app.handle(
          new Request('http://localhost/api/records', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(key ? { authorization: `Bearer ${key}` } : {}),
            },
            body: JSON.stringify({ changeMessage: 'Imported test record', ...(body as object) }),
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

test('record ingestion rejects invalid, foreign and archived asset references without replacing a published record', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      for (const id of [OWNER_USER_ID, 'other-owner']) {
        await database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${id}, ${id}, ${`${id}@example.invalid`}, 1, ${NOW}, ${NOW})`;
      }
      const storage = createLocalStorage({ dataFolder });
      const assets = new AssetsService({
        assets: new AssetsRepository(database),
        storage,
        faces: unusedAssetFacesService,
      });
      const recordsService = new RecordsService({
        records: new RecordsRepository(database),
        storage,
      });
      const apiKeysService = new ApiKeysService({ keys: new ApiKeysRepository(database) });
      const created = await apiKeysService.create({ actorId: OWNER_USER_ID, name: 'Asset sender' });
      if (created.state !== 'created') {
        throw new Error('Expected key');
      }
      const change = { clientName: 'test', message: 'Added record assets' };
      for (const [ownerId, name] of [
        [OWNER_USER_ID, 'Active'],
        [OWNER_USER_ID, 'Archived'],
        ['other-owner', 'Foreign'],
      ] as const) {
        expect(
          (await assets.create({ ownerId, name, file: new Blob(['Text asset']), change })).state,
        ).toBe('created');
      }
      await assets.archive({ ownerId: OWNER_USER_ID, readableId: 'archived', change });
      const app = new Elysia({ prefix: '/api' })
        .onError(elysiaErrorHandler)
        .use(createRecordWriteController({ apiKeysService, recordsService }));
      const record = {
        source: { provider: 'fixture', kind: 'summary', id: 'record' },
        title: 'Attachments',
        body: '[File](context-use://asset/active)',
        sourceUpdatedAt: NOW,
      };
      const post = (body: typeof record) =>
        app.handle(
          new Request('http://localhost/api/records', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${created.apiKey}`,
            },
            body: JSON.stringify({ ...body, changeMessage: 'Published attachment summary' }),
          }),
        );
      const initial = await post(record);
      expect(initial.status).toBe(StatusMap.OK);
      const { readableId } = await initial.json();
      const history = await new HistoryRepository(database).list({
        ownerId: OWNER_USER_ID,
        limit: 100,
      });
      for (const id of ['missing', 'foreign', 'archived', '../../invalid']) {
        const response = await post({
          ...record,
          body: `[File](context-use://asset/${id})`,
          sourceUpdatedAt: '2026-09-10T09:00:00.000Z',
        });
        expect(response.status).toBe(StatusMap['Bad Request']);
        expect(await response.json()).toEqual({
          error: 'Record asset references must identify available assets owned by this user.',
        });
      }
      expect(
        (await recordsService.findResource({ ownerId: OWNER_USER_ID, readableId }))?.body,
      ).toBe(record.body);
      expect(
        await new HistoryRepository(database).list({ ownerId: OWNER_USER_ID, limit: 100 }),
      ).toEqual(history);
      expect(
        (await assets.archive({ ownerId: OWNER_USER_ID, readableId: 'active', change })).state,
      ).toBe('resource_in_use');
      const detail = await assets.detail({ ownerId: OWNER_USER_ID, readableId: 'active' });
      expect(detail?.usages).toEqual([
        {
          kind: 'record',
          presentation: 'attachment',
          record: {
            readableId,
            title: record.title,
            source: { provider: 'fixture', kind: 'summary' },
          },
        },
      ]);
      expect(McpAssetSchema.safeParse(mcpAsset(detail!)).success).toBe(true);
    },
  });
});
