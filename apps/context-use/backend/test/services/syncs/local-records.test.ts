import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import type {
  Deliverable,
  DeliveredRecord,
  DestinationType,
} from '@context-use/open-sync/delivery';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import type { JsonObject } from '@context-use/open-sync/json';
import type { SQL } from 'bun';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { HistoryRepository } from '#backend/repositories/history/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { localRecordDestination } from '#backend/services/syncs/destinations/local/definition.ts';
import {
  githubPullRequests,
  stepGithubPullRequests,
} from '#backend/services/syncs/sources/github/pull-requests.ts';
import { githubRecord } from '#backend/services/syncs/sources/github/record.ts';
import { withRecordTestDatabase } from '../../repositories/records/database.ts';
import { now, page, pull } from './github-fixture.ts';

const scope = { actorId: OWNER_USER_ID, ownerId: OWNER_USER_ID };
const definition = githubPullRequests.registration;
const SOURCE_RECORD_COUNT = 3;
const HISTORY_AFTER_UPDATE = 3;
const ISOLATED_SYNC_RECORD_COUNT = 4;
const WITH_API_RECORD_COUNT = 5;
const DAY_MS = 86_400_000;
const HISTORY_AFTER_NEW_AND_EDITED = 5;
function unexpected(): never {
  throw new Error('Unexpected operation');
}
async function store(input: { database: SQL; dataFolder: string }) {
  await input.database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${OWNER_USER_ID}, 'Owner', ${OWNER_SYNTHETIC_EMAIL}, 1, ${now}, ${now})`;
  const records = new RecordsService({
    records: new RecordsRepository(input.database),
    storage: createLocalStorage(input),
  });
  const destination = localRecordDestination({
    importAsset: unexpected,
    ownerId: OWNER_USER_ID,
    upsertRecord: (value) => records.upsert(value),
    definitions: [definition],
  });
  return {
    records,
    destination,
    list: () => records.listResources({ ownerId: OWNER_USER_ID, limit: 100, offset: 0 }),
    history: () =>
      new HistoryRepository(input.database).list({
        ownerId: OWNER_USER_ID,
        limit: 100,
        resourceType: 'record',
      }),
  };
}
function bundle(records: DeliveredRecord[]): Deliverable {
  return {
    id: 'delivery',
    ownerId: OWNER_USER_ID,
    syncId: 'sync',
    definition: definition.definition.id,
    records,
    assets: [],
    openAsset: unexpected,
  };
}
function delivery(deliverable: Deliverable) {
  return { scope, config: {}, deliverable, signal: new AbortController().signal };
}

test('npm engine immediately backfills native pages across restart, then polls only the updated prefix', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      const host = await store(input);
      const requested: Array<{ cursor: string | null; updates: boolean }> = [];
      let malformed = true;
      let edited: JsonObject | undefined;
      let added: JsonObject | undefined;
      const options = {
        databasePath: join(input.dataFolder, 'sync.db'),
        definitions: [definition],
        destinationTypes: { local: host.destination },
        connector: {
          bind: async () => ({
            get: unexpected,
            action: unexpected,
            post: ({ body }: { body: JsonObject }) => {
              const cursor = (body.variables as JsonObject).after as string | null;
              const updates = String(body.query).includes('UPDATED_AT');
              requested.push({ cursor, updates });
              let result: JsonObject;
              if (updates) {
                const changed = [added, edited].filter(
                  (record): record is JsonObject => record !== undefined,
                );
                result = page({ nodes: [...changed, pull({ id: 'PR_three' })], more: true });
              } else if (cursor === null) {
                result = page({
                  nodes: [edited ?? pull(), malformed ? { id: 'invalid' } : pull({ id: 'PR_two' })],
                  more: true,
                });
              } else {
                result = page({
                  cursor: 'last',
                  nodes: [
                    pull({ id: 'PR_three' }),
                    ...[added].filter((record): record is JsonObject => record !== undefined),
                  ],
                });
              }
              return Promise.resolve({ status: 200, headers: {}, body: result });
            },
          }),
        },
      };
      let runtime = createSyncRuntime(options);
      try {
        const sync = await runtime.api.createSync({
          ...scope,
          definition: definition.definition.id,
          connection: { id: 'github-owner', service: 'github' },
          destination: { type: 'local', input: {} },
          config: {},
          intervalMs: DAY_MS,
        });
        await runtime.tick();
        expect(runtime.api.status(scope).queue.pendingRecords).toBe(0);
        expect(runtime.api.polls({ ...scope, id: sync.id }).polls[0]?.recordsProcessed).toBe(0);
        expect((await host.list()).items).toEqual([]);
        malformed = false;
        runtime.api.runNow({ ...scope, id: sync.id });
        await runtime.tick();
        expect(runtime.api.status(scope).queue.pendingRecords).toBe(2);
        await runtime.close();
        runtime = createSyncRuntime(options);
        await runtime.tick();
        await runtime.tick();
        expect(requested).toEqual([
          { cursor: null, updates: false },
          { cursor: null, updates: false },
          { cursor: 'cursor-1', updates: false },
        ]);
        expect((await host.list()).items).toHaveLength(SOURCE_RECORD_COUNT);
        expect((await host.history()).items).toHaveLength(SOURCE_RECORD_COUNT);
        requested.length = 0;
        await runtime.tick();
        expect(requested).toEqual([]);
        runtime.api.runNow({ ...scope, id: sync.id });
        await runtime.tick();
        await runtime.tick();
        expect(requested).toEqual([{ cursor: null, updates: true }]);
        expect((await host.history()).items).toHaveLength(SOURCE_RECORD_COUNT);
        requested.length = 0;
        const updatedAt = new Date().toISOString();
        edited = {
          ...pull({ title: 'An older PR was edited', updatedAt }),
          body: 'Revised **Markdown**',
        };
        added = pull({ id: 'PR_new', createdAt: updatedAt, updatedAt });
        runtime.api.runNow({ ...scope, id: sync.id });
        await runtime.tick();
        await runtime.tick();
        expect(requested).toEqual([{ cursor: null, updates: true }]);
        expect((await host.list()).items).toHaveLength(ISOLATED_SYNC_RECORD_COUNT);
        expect((await host.history()).items).toHaveLength(HISTORY_AFTER_NEW_AND_EDITED);
        const record = (await host.list()).items.find((item) => item.source.id === 'PR_one')!;
        expect(record.title).toContain('An older PR was edited');
        const resource = await host.records.findResource({
          ownerId: OWNER_USER_ID,
          readableId: record.readableId,
        });
        expect(resource?.body).toBe(githubRecord(edited).content.body);
        expect(resource?.sourceCreatedAt).toBe(now);
        expect(resource?.sourceUpdatedAt).toBe(updatedAt);
        requested.length = 0;
        await runtime.api.resync({ ...scope, id: sync.id });
        await runtime.tick();
        await runtime.tick();
        await runtime.tick();
        expect(requested).toEqual([
          { cursor: null, updates: false },
          { cursor: 'cursor-1', updates: false },
        ]);
        expect((await host.history()).items).toHaveLength(HISTORY_AFTER_NEW_AND_EDITED);
      } finally {
        await runtime.close();
      }
    },
  });
});

test('incremental page failures and cursor expiry preserve the frozen scan through restart, and the next poll catches edits made during it', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      const host = await store(input);
      const checkpoints: JsonObject[] = [];
      const completed: SyncStep[] = [];
      const registration = {
        ...definition,
        load: () => ({
          step: async (context: SyncContext) => {
            checkpoints.push(structuredClone(context.checkpoint) as JsonObject);
            const step = await stepGithubPullRequests(context);
            completed.push(step);
            return step;
          },
        }),
      };
      const requests: Array<string | null> = [];
      const responses: JsonObject[] = [page({ nodes: [] })];
      const options = {
        databasePath: join(input.dataFolder, 'sync.db'),
        definitions: [registration],
        destinationTypes: { local: host.destination },
        connector: {
          bind: async () => ({
            get: unexpected,
            action: unexpected,
            post: ({ body }: { body: JsonObject }) => {
              requests.push((body.variables as JsonObject).after as string | null);
              const response = responses.shift();
              if (!response) {
                throw new Error('Unexpected historical page request');
              }
              return Promise.resolve({ status: 200, headers: {}, body: response });
            },
          }),
        },
      };
      let runtime = createSyncRuntime(options);
      try {
        const sync = await runtime.api.createSync({
          ...scope,
          definition: definition.definition.id,
          connection: { id: 'github-owner', service: 'github' },
          destination: { type: 'local', input: {} },
          config: {},
          intervalMs: DAY_MS,
        });
        await runtime.tick();
        const watermark = (completed.at(-1)!.checkpoint as JsonObject).watermark;
        const recent = new Date().toISOString();
        const first = page({
          nodes: [pull({ updatedAt: recent }), pull({ id: 'PR_two', updatedAt: recent })],
          more: true,
        });
        responses.push(
          first,
          page({
            cursor: 'bad',
            nodes: [pull({ id: 'uncommitted', updatedAt: recent }), { id: 'invalid' }],
            more: true,
          }),
        );
        runtime.api.runNow({ ...scope, id: sync.id });
        await runtime.tick();
        const inProgress = completed.at(-1)!.checkpoint as JsonObject;
        expect(inProgress).toMatchObject({ watermark, cursor: 'cursor-1' });
        await runtime.tick();
        expect(completed.at(-1)!.checkpoint).toEqual(inProgress);
        expect((await host.list()).items.map((item) => item.source.id).sort()).toEqual([
          'PR_one',
          'PR_two',
        ]);
        await runtime.close();
        runtime = createSyncRuntime(options);
        responses.push({ errors: [{ type: 'INVALID_CURSOR' }] });
        runtime.api.runNow({ ...scope, id: sync.id });
        await runtime.tick();
        expect(checkpoints.at(-1)).toEqual(inProgress);
        expect(completed.at(-1)!.checkpoint).toEqual({ ...inProgress, cursor: null });
        responses.push(
          first,
          page({
            cursor: 'end',
            nodes: [pull({ id: 'PR_three', updatedAt: recent }), pull({ id: 'historical' })],
            more: true,
          }),
        );
        await runtime.tick();
        await runtime.tick();
        await runtime.tick();
        expect(completed.at(-1)!.checkpoint).toEqual({
          accountId: 'U_owner',
          cursor: null,
          cycleStartedAt: null,
          watermark: inProgress.cycleStartedAt!,
        });
        expect(requests).toEqual([null, null, 'cursor-1', 'cursor-1', null, 'cursor-1']);
        expect((await host.list()).items).toHaveLength(SOURCE_RECORD_COUNT);
        expect((await host.history()).items).toHaveLength(SOURCE_RECORD_COUNT);
        const duringScan = new Date(
          Date.parse(String(inProgress.cycleStartedAt)) + 1,
        ).toISOString();
        responses.push(
          page({
            nodes: [
              pull({ title: 'Edited during scan', updatedAt: duringScan }),
              pull({ id: 'historical' }),
            ],
            more: true,
          }),
        );
        runtime.api.runNow({ ...scope, id: sync.id });
        await runtime.tick();
        await runtime.tick();
        expect(
          (await host.list()).items.find((record) => record.source.id === 'PR_one')?.title,
        ).toContain('Edited during scan');
        expect((await host.history()).items).toHaveLength(ISOLATED_SYNC_RECORD_COUNT);
        expect(responses).toEqual([]);
      } finally {
        await runtime.close();
      }
    },
  });
});

test('partial publication and a lost acknowledgement replay after restart without duplicate history or stale overwrites', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      const host = await store(input);
      let failSecond = true;
      let loseAcknowledgement = true;
      const seenIds: string[] = [];
      const receiver = localRecordDestination({
        importAsset: unexpected,
        ownerId: OWNER_USER_ID,
        definitions: [definition],
        upsertRecord: (value) => {
          if (failSecond && value.record.source.id === 'PR_two') {
            throw new Error('Storage unavailable');
          }
          return host.records.upsert(value);
        },
      });
      const destination: DestinationType = {
        ...receiver,
        deliver: async (value) => {
          seenIds.push(value.deliverable.id);
          const result = await receiver.deliver(value);
          if (loseAcknowledgement) {
            throw new Error('Acknowledgement lost');
          }
          return result;
        },
      };
      const options = {
        databasePath: join(input.dataFolder, 'sync.db'),
        definitions: [definition],
        destinationTypes: { local: destination },
        connector: {
          bind: async () => ({
            get: unexpected,
            action: unexpected,
            post: async () => ({
              status: 200,
              headers: {},
              body: page({ nodes: [pull(), pull({ id: 'PR_two' })] }),
            }),
          }),
        },
      };
      let runtime = createSyncRuntime(options);
      try {
        const sync = await runtime.api.createSync({
          ...scope,
          definition: definition.definition.id,
          connection: { id: 'github-owner', service: 'github' },
          destination: { type: 'local', input: {} },
          config: {},
        });
        await runtime.tick();
        await runtime.tick();
        expect((await host.list()).items).toHaveLength(1);
        const pending = runtime.api.deliveries({ ...scope, syncId: sync.id }).deliveries[0]!;
        const original = {
          ...runtime.api.deliverable({ ...scope, syncId: sync.id, id: pending.id }),
          openAsset: unexpected,
        };
        failSecond = false;
        runtime.api.retryDelivery({ ...scope, syncId: sync.id, id: pending.id });
        await runtime.tick();
        expect((await host.list()).items).toHaveLength(2);
        expect(runtime.api.status(scope).queue.pendingRecords).toBe(2);
        await runtime.close();
        loseAcknowledgement = false;
        runtime = createSyncRuntime(options);
        runtime.api.retryDelivery({ ...scope, syncId: sync.id, id: pending.id });
        await runtime.tick();
        expect(runtime.api.status(scope).queue.pendingRecords).toBe(0);
        expect(new Set(seenIds)).toEqual(new Set([pending.id]));
        expect((await host.history()).items).toHaveLength(2);
        const newer = {
          ...githubRecord(pull({ title: 'Updated at the same upstream timestamp' })),
          revision: 3,
        };
        const updated = { ...original, records: [newer] };
        expect(await host.destination.deliver(delivery(updated))).toEqual({ status: 'accepted' });
        expect(await host.destination.deliver(delivery(original))).toEqual({ status: 'accepted' });
        expect(
          (await host.list()).items.some((item) => item.title.includes('Updated at the same')),
        ).toBe(true);
        expect((await host.history()).items).toHaveLength(HISTORY_AFTER_UPDATE);
        // A newer unchanged revision must also fence older, different content.
        await host.destination.deliver(
          delivery({ ...updated, records: [{ ...newer, revision: 5 }] }),
        );
        await host.destination.deliver(
          delivery({ ...updated, records: [{ ...githubRecord(pull()), revision: 4 }] }),
        );
        expect((await host.history()).items).toHaveLength(HISTORY_AFTER_UPDATE);
        expect(
          await host.destination.deliver(
            delivery({ ...updated, records: [{ ...githubRecord(pull()), revision: 5 }] }),
          ),
        ).toEqual({ status: 'rejected', code: 'conflict' });
        await host.destination.deliver(delivery({ ...original, syncId: 'another-sync' }));
        expect((await host.list()).items).toHaveLength(ISOLATED_SYNC_RECORD_COUNT);
        expect(
          await host.destination.deliver({
            ...delivery(original),
            scope: { actorId: 'other', ownerId: 'other' },
          }),
        ).toEqual({ status: 'rejected', code: 'invalid_source' });
        expect(
          (await host.records.listResources({ ownerId: 'other', limit: 10, offset: 0 })).items,
        ).toEqual([]);
        // API ingestion of the same source identity is independent from configured syncs.
        await host.records.upsert({
          ownerId: OWNER_USER_ID,
          record: {
            source: { provider: 'github', kind: 'pull-request', id: 'PR_one' },
            title: 'API record',
            body: 'Independent',
          },
          change: { clientName: 'test', message: 'Imported API record' },
        });
        expect((await host.list()).items).toHaveLength(WITH_API_RECORD_COUNT);
      } finally {
        await runtime.close();
      }
    },
  });
});

test('unavailable assets, deletes, malformed batches and cancellation cannot acknowledge dropped or incomplete records', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      const host = await store(input);
      const record = { ...githubRecord(pull()), revision: 1 };
      const valid = bundle([record]);
      for (const invalid of [
        {
          ...valid,
          assets: [
            {
              id: 'asset',
              version: '1',
              name: 'file',
              mediaType: 'text/plain',
              unavailable: 'unavailable',
            },
          ],
        },
        bundle([{ ...record, assetRefs: { file: { id: 'asset', version: '1' } } }]),
        bundle([record, { operation: 'delete', kind: 'pull-request', id: 'deleted', revision: 1 }]),
        bundle([record, { ...record, id: 'bad', content: undefined }]),
        { ...valid, definition: 'unknown' },
      ]) {
        expect((await host.destination.deliver(delivery(invalid))).status).toBe('rejected');
      }
      expect((await host.list()).items).toEqual([]);
      const abort = new AbortController();
      const cancelled = localRecordDestination({
        importAsset: unexpected,
        ownerId: OWNER_USER_ID,
        definitions: [definition],
        upsertRecord: async (value) => {
          const result = await host.records.upsert(value);
          abort.abort();
          return result;
        },
      });
      const batch = bundle([record, { ...githubRecord(pull({ id: 'PR_two' })), revision: 1 }]);
      await expect(
        cancelled.deliver({ ...delivery(batch), signal: abort.signal }),
      ).rejects.toThrow();
      expect((await host.list()).items).toHaveLength(1);
      expect(await host.destination.deliver(delivery(batch))).toEqual({ status: 'accepted' });
      expect((await host.history()).items).toHaveLength(2);
      expect(
        (await host.history()).items.every((item) => item.message === 'Synced record from github'),
      ).toBe(true);
    },
  });
});
