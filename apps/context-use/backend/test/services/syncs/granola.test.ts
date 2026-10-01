import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { SyncContext } from '@context-use/open-sync/definition';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import type { JsonObject } from '@context-use/open-sync/json';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { HistoryRepository } from '#backend/repositories/history/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { localRecordDestination } from '#backend/services/syncs/destinations/local/definition.ts';
import { granolaMeetings } from '#backend/services/syncs/sources/granola/meetings/definition.ts';
import { withRecordTestDatabase } from '../../repositories/records/database.ts';
import { now } from './github-fixture.ts';

const scope = { actorId: OWNER_USER_ID, ownerId: OWNER_USER_ID };
function unexpected(): never {
  throw new Error('Unexpected operation');
}
function meeting(id: string): JsonObject {
  return {
    id,
    title: `Planning ${id}`,
    date: '2026-09-19',
    attendees: 'Alice, Sam',
    summary: '## Decisions\nShip **it**.',
  };
}
const SECOND_BATCH_END = 20;
const DETAIL_BATCH_COUNT = 3;
const CHANGES_AFTER_EMPTY = 3;
const MEETING_COUNT = 23;
const ids = [...Array(MEETING_COUNT).keys()].map((index) => String(index).padStart(2, '0'));
const batches = [ids.slice(0, 10), ids.slice(10, SECOND_BATCH_END), ids.slice(SECOND_BATCH_END)];

async function fixture({
  run,
  action,
}: {
  run: (f: {
    records: RecordsService;
    history: () => Promise<Awaited<ReturnType<HistoryRepository['list']>>>;
    restart: () => Promise<void>;
    runtime: () => ReturnType<typeof createSyncRuntime>;
    syncId: string;
  }) => Promise<void>;
  action: SyncContext['provider']['action'];
}) {
  await withRecordTestDatabase({
    run: async (input) => {
      await input.database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${OWNER_USER_ID}, 'Owner', 'owner@example.invalid', 1, ${now}, ${now})`;
      const records = new RecordsService({
        records: new RecordsRepository(input.database),
        storage: createLocalStorage(input),
      });
      const destination = localRecordDestination({
        ownerId: OWNER_USER_ID,
        definitions: [granolaMeetings],
        importAsset: unexpected,
        upsertRecord: (value) => records.upsert(value),
      });
      const options = {
        databasePath: join(input.dataFolder, 'sync.db'),
        definitions: [granolaMeetings],
        destinationTypes: { local: destination },
        connector: { bind: async () => ({ get: unexpected, post: unexpected, action }) },
      };
      let runtime = createSyncRuntime(options);
      try {
        const sync = await runtime.api.createSync({
          ...scope,
          definition: 'granola.meetings',
          connection: { id: 'granola-owner', service: 'granola' },
          destination: { type: 'local', input: {} },
          config: {},
          intervalMs: 86_400_000,
        });
        await run({
          records,
          syncId: sync.id,
          runtime: () => runtime,
          restart: async () => {
            await runtime.close();
            runtime = createSyncRuntime(options);
          },
          history: () =>
            new HistoryRepository(input.database).list({
              ownerId: OWNER_USER_ID,
              limit: 100,
              resourceType: 'record',
            }),
        });
      } finally {
        await runtime.close();
      }
    },
  });
}

test('Granola backfills every accessible meeting and only publishes changes across restart; disappearing meetings are kept', async () => {
  let listing = ids;
  let edited = false;
  let empty = false;
  let missingSummary = false;
  const requests: string[][] = [];
  await fixture({
    run: async (f) => {
      const poll = async () => {
        f.runtime().api.runNow({ ...scope, id: f.syncId });
        await f.runtime().tick();
        await f.runtime().tick();
      };
      const list = () => f.records.listResources({ ownerId: OWNER_USER_ID, limit: 100, offset: 0 });
      await poll();
      expect(requests).toEqual(batches);
      expect((await list()).items).toHaveLength(ids.length);
      const first = (await list()).items.find((item) => item.source.id === '00')!;
      expect(
        await f.records.findResource({ ownerId: OWNER_USER_ID, readableId: first.readableId }),
      ).toMatchObject({
        title: 'Planning 00',
        body: 'Date: 2026-09-19\n\nAttendees: Alice, Sam\n\n## Decisions\nShip **it**.',
        source: { provider: 'granola', kind: 'meeting', id: '00' },
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
      });
      expect((await f.history()).items).toHaveLength(ids.length);
      await f.restart();
      await poll();
      expect((await f.history()).items).toHaveLength(ids.length);
      missingSummary = true;
      await poll();
      expect(f.runtime().api.syncs(scope)[0]?.status).toBe('retrying');
      expect(f.runtime().api.status(scope).queue.pendingRecords).toBe(0);
      expect((await f.history()).items).toHaveLength(ids.length);
      expect(
        await f.records.findResource({ ownerId: OWNER_USER_ID, readableId: first.readableId }),
      ).toMatchObject({
        body: 'Date: 2026-09-19\n\nAttendees: Alice, Sam\n\n## Decisions\nShip **it**.',
      });
      await f.restart();
      missingSummary = false;
      edited = true;
      listing = [...ids.slice(0, -1), 'new'];
      await poll();
      expect((await list()).items).toHaveLength(ids.length + 1);
      expect((await f.history()).items).toHaveLength(ids.length + 2);
      expect(
        await f.records.findResource({ ownerId: OWNER_USER_ID, readableId: first.readableId }),
      ).toMatchObject({ body: 'Date: 2026-09-19\n\nAttendees: Alice, Sam\n\nEdited notes' });
      empty = true;
      await poll();
      expect((await f.history()).items).toHaveLength(ids.length + CHANGES_AFTER_EMPTY);
      expect(
        await f.records.findResource({ ownerId: OWNER_USER_ID, readableId: first.readableId }),
      ).toMatchObject({ title: 'Untitled Granola meeting', body: '' });
      listing = [];
      await poll();
      expect((await list()).items).toHaveLength(ids.length + 1);
      expect(
        (await f.records.listResources({ ownerId: 'other', limit: 100, offset: 0 })).items,
      ).toEqual([]);
    },
    action: ({ id, input }) => {
      if (id === 'granola.list_meetings') {
        return Promise.resolve({
          meetings: listing.map((id) => ({ id, title: `Planning ${id}` })).reverse(),
        });
      }
      expect(id).toBe('granola.get_meetings');
      const batch = input.meeting_ids as string[];
      requests.push(batch);
      return Promise.resolve({
        meetings: batch
          .map((id): JsonObject => {
            const detail: JsonObject =
              id === '00' && empty
                ? { id, title: null, summary: '' }
                : { ...meeting(id), ...(id === '00' && edited ? { summary: 'Edited notes' } : {}) };
            if (missingSummary && id === '00') {
              delete detail.summary;
            }
            return detail;
          })
          .reverse(),
      });
    },
  });
});

test.each([
  'transient',
  'missing',
  'duplicate',
  'foreign',
  'missing-summary',
  'duplicate-listing',
  'cancelled',
] as const)(
  'Granola %s failure publishes nothing and retries the entire listing after restart',
  async (mode) => {
    let fail = true;
    let listings = 0;
    const requests: string[][] = [];
    function incomplete(meetings: JsonObject[]): JsonObject[] {
      switch (mode) {
        case 'transient':
          throw new Error('Upstream unavailable');
        case 'cancelled':
          throw new DOMException('Cancelled', 'AbortError');
        case 'missing':
          return meetings.slice(1);
        case 'duplicate':
          return [...meetings, meetings[0]!];
        case 'foreign':
          return [...meetings.slice(1), meeting('unexpected')];
        case 'missing-summary':
          delete meetings[0]!.summary;
          return meetings;
        default:
          return meetings;
      }
    }
    await fixture({
      run: async (f) => {
        await f.runtime().tick();
        expect(f.runtime().api.syncs(scope)[0]).toMatchObject({ status: 'retrying' });
        expect(f.runtime().api.status(scope).queue.pendingRecords).toBe(0);
        expect(
          (await f.records.listResources({ ownerId: OWNER_USER_ID, limit: 100, offset: 0 })).items,
        ).toEqual([]);
        expect((await f.history()).items).toEqual([]);
        if (mode === 'duplicate-listing') {
          expect(requests).toEqual([]);
        }
        await f.restart();
        fail = false;
        f.runtime().api.runNow({ ...scope, id: f.syncId });
        await f.runtime().tick();
        await f.runtime().tick();
        expect(listings).toBe(2);
        expect(requests.slice(-DETAIL_BATCH_COUNT)).toEqual(batches);
        expect((await f.history()).items).toHaveLength(ids.length);
      },
      action: ({ id, input }) => {
        if (id === 'granola.list_meetings') {
          listings++;
          return Promise.resolve({
            meetings: (mode === 'duplicate-listing' && fail ? [...ids, ids[0]!] : ids).map(meeting),
          });
        }
        const batch = input.meeting_ids as string[];
        requests.push(batch);
        let meetings = batch.map(meeting);
        if (fail && batch.includes('20')) {
          meetings = incomplete(meetings);
        }
        return Promise.resolve({ meetings });
      },
    });
  },
);
