import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { SyncContext, SyncRegistration } from '@context-use/open-sync/definition';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import type { JsonObject } from '@context-use/open-sync/json';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { HistoryRepository } from '#backend/repositories/history/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { localRecordDestination } from '#backend/services/syncs/destinations/local/definition.ts';
import { granolaMeetings } from '#backend/services/syncs/sources/granola/meetings/definition.ts';
import { meetingIdFromUrl } from '#backend/services/syncs/sources/granola/meetings/identity.ts';
import { granolaRecord } from '#backend/services/syncs/sources/granola/meetings/record.ts';
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
const HEX_RADIX = 16;
const UUID_SUFFIX_LENGTH = 12;
function meetingId(index: number) {
  return `abcdef00-0000-4000-8000-${index.toString(HEX_RADIX).padStart(UUID_SUFFIX_LENGTH, '0')}`;
}
const ids = [...Array(MEETING_COUNT).keys()].map(meetingId);
const batches = [ids.slice(0, 10), ids.slice(10, SECOND_BATCH_END), ids.slice(SECOND_BATCH_END)];

test.each([
  { date: '2026-09-19', occurredAt: '2026-09-19' },
  { date: '2026-09-19T09:00:00+01:00', occurredAt: '2026-09-19T09:00:00+01:00' },
  { date: undefined, occurredAt: null },
  { date: 'September 19', occurredAt: null },
])('Granola preserves known occurrence precision for $date', ({ date, occurredAt }) => {
  const record = granolaRecord({ id: ids[0]!, title: 'Planning', summary: '', date });
  expect(record.data.occurredAt).toBe(occurredAt);
  expect(record.data.date).toBe(date ?? null);
});

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
      const first = (await list()).items.find((item) => item.source.id === ids[0])!;
      expect(
        await f.records.findResource({ ownerId: OWNER_USER_ID, readableId: first.readableId }),
      ).toMatchObject({
        title: `Planning ${ids[0]}`,
        body: 'Date: 2026-09-19\n\nAttendees: Alice, Sam\n\n## Decisions\nShip **it**.',
        source: { provider: 'granola', kind: 'meeting', id: ids[0] },
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
        occurredAt: '2026-09-19',
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
      listing = [...ids.slice(0, -1), meetingId(MEETING_COUNT)];
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
      expect(
        (await f.records.findResource({ ownerId: OWNER_USER_ID, readableId: first.readableId }))!
          .occurredAt,
      ).toBeNull();
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
              id === ids[0] && empty
                ? { id, title: null, summary: '' }
                : {
                    ...meeting(id),
                    ...(id === ids[0] && edited ? { summary: 'Edited notes' } : {}),
                  };
            if (missingSummary && id === ids[0]) {
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
  'invalid-listing-id',
  'invalid-detail-id',
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
          return [...meetings.slice(1), meeting(meetingId(MEETING_COUNT + 1))];
        case 'invalid-detail-id':
          meetings[0]!.id = 'not_1d3tmYTlCICgjy';
          return meetings;
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
        if (mode === 'duplicate-listing' || mode === 'invalid-listing-id') {
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
            meetings: (fail && mode === 'invalid-listing-id'
              ? ['not_1d3tmYTlCICgjy']
              : mode === 'duplicate-listing' && fail
                ? [...ids, ids[0]!]
                : ids
            ).map(meeting),
          });
        }
        const batch = input.meeting_ids as string[];
        requests.push(batch);
        let meetings = batch.map(meeting);
        if (fail && batch.includes(ids[SECOND_BATCH_END]!)) {
          meetings = incomplete(meetings);
        }
        return Promise.resolve({ meetings });
      },
    });
  },
);

// Test-only replacement source: the production integration still uses MCP.
test('replacing MCP with API records preserves existing record identity and adds older history', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      await input.database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${OWNER_USER_ID}, 'Owner', 'owner@example.invalid', 1, ${now}, ${now})`;
      const records = new RecordsService({
        records: new RecordsRepository(input.database),
        storage: createLocalStorage(input),
      });
      const notes = [
        {
          id: 'not_1d3tmYTlCICgjy',
          web_url: `https://notes.granola.ai/d/${ids[0]}`,
          title: 'Planning',
          summary_markdown: 'Updated through API',
        },
        {
          id: 'not_2d3tmYTlCICgjy',
          web_url: `https://notes.granola.ai/d/${ids[1]}`,
          title: 'Older meeting',
          summary_markdown: 'Historical notes',
        },
      ];
      const apiRegistration: SyncRegistration = {
        ...granolaMeetings,
        definition: {
          ...granolaMeetings.definition,
          provider: { service: 'granola', actions: ['granola.get_note'] },
        },
        load: () => ({
          step: async (context) => {
            const delivered = [];
            for (const stub of notes) {
              const result = await context.provider.action({
                id: 'granola.get_note',
                input: { note_id: stub.id },
              });
              const note = (result as { note: typeof stub }).note;
              delivered.push(
                granolaRecord({
                  id: meetingIdFromUrl(note.web_url),
                  title: note.title,
                  summary: note.summary_markdown,
                }),
              );
            }
            return { records: delivered, checkpoint: {}, complete: true };
          },
        }),
      };
      const destination = localRecordDestination({
        ownerId: OWNER_USER_ID,
        definitions: [granolaMeetings],
        importAsset: unexpected,
        upsertRecord: (value) => records.upsert(value),
      });
      const options = {
        databasePath: join(input.dataFolder, 'sync.db'),
        destinationTypes: { local: destination },
        connector: {
          bind: async () => ({
            get: unexpected,
            post: unexpected,
            action: ({ id, input: request }: Parameters<SyncContext['provider']['action']>[0]) => {
              if (id === 'granola.list_meetings') {
                return Promise.resolve({ meetings: [meeting(ids[0]!.toUpperCase())] });
              }
              if (id === 'granola.get_meetings') {
                return Promise.resolve({ meetings: [meeting(ids[0]!.toUpperCase())] });
              }
              expect(id).toBe('granola.get_note');
              const note = notes.find((item) => item.id === request.note_id);
              expect(note).toBeDefined();
              return Promise.resolve({ note: note! });
            },
          }),
        },
      };
      let runtime = createSyncRuntime({ ...options, definitions: [granolaMeetings] });
      try {
        const sync = await runtime.api.createSync({
          ...scope,
          definition: 'granola.meetings',
          connection: { id: 'granola-owner', service: 'granola' },
          destination: { type: 'local', input: {} },
          config: {},
          intervalMs: 86_400_000,
        });
        const poll = async () => {
          runtime.api.runNow({ ...scope, id: sync.id });
          await runtime.tick();
          await runtime.tick();
        };
        const list = () => records.listResources({ ownerId: OWNER_USER_ID, limit: 100, offset: 0 });
        await poll();
        const original = (await list()).items[0]!;
        expect(original.source).toMatchObject({ provider: 'granola', kind: 'meeting', id: ids[0] });
        await runtime.close();
        runtime = createSyncRuntime({ ...options, definitions: [apiRegistration] });
        await poll();
        const migrated = (await list()).items;
        expect(migrated).toHaveLength(2);
        expect(migrated.find((record) => record.source.id === ids[0])?.readableId).toBe(
          original.readableId,
        );
        expect(
          await records.findResource({ ownerId: OWNER_USER_ID, readableId: original.readableId }),
        ).toMatchObject({ title: 'Planning', body: 'Updated through API' });
        expect(migrated.find((record) => record.source.id === ids[1])?.title).toBe('Older meeting');
        await poll();
        expect((await list()).items).toHaveLength(2);
        expect(
          (
            await new HistoryRepository(input.database).list({
              ownerId: OWNER_USER_ID,
              limit: 100,
              resourceType: 'record',
            })
          ).items,
        ).toHaveLength(notes.length + 1);
      } finally {
        await runtime.close();
      }
    },
  });
});
