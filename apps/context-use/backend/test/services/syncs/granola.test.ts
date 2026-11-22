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
import { stepGranolaMeetings } from '#backend/services/syncs/sources/granola/meetings/step.ts';
import { withRecordTestDatabase } from '../../repositories/records/database.ts';
import { now } from './github-fixture.ts';

const scope = { actorId: OWNER_USER_ID, ownerId: OWNER_USER_ID };
function unexpected(): never {
  throw new Error('Unexpected operation');
}
const created = '2026-01-19T09:00:00Z';
const uuidSuffixLength = 12;
const publicIdLength = 14;
const originalAndEditedHistoryCount = 3;
const occurred = '2026-01-19T10:00:00Z';
function uuid(index: number) {
  return `abcdef00-0000-4000-8000-${String(index).padStart(uuidSuffixLength, '0')}`;
}
function noteId(index: number) {
  return `not_${String(index).padStart(publicIdLength, '0')}`;
}
function note(index: number) {
  return {
    id: noteId(index),
    web_url: `https://notes.granola.ai/d/${uuid(index)}`,
    title: `Planning ${index}`,
    summary_text: 'Plain summary',
    summary_markdown: '## Decisions\nShip **it**.',
    created_at: created,
    updated_at: created,
    deleted_at: null,
    calendar_event: { scheduled_start_time: occurred },
    attendees: [{ name: 'Alice', email: 'alice@example.invalid' }],
  };
}
function ok(body: JsonObject) {
  return { status: 200, headers: {}, body };
}
async function fixture({
  run,
  get,
}: {
  run: (f: {
    records: RecordsService;
    history: () => Promise<Awaited<ReturnType<HistoryRepository['list']>>>;
    restart: (registration?: SyncRegistration) => Promise<void>;
    runtime: () => ReturnType<typeof createSyncRuntime>;
    syncId: string;
  }) => Promise<void>;
  get: SyncContext['provider']['get'];
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
        connector: { bind: async () => ({ get, post: unexpected, action: unexpected }) },
      };
      let runtime = createSyncRuntime(options);
      try {
        const sync = await runtime.api.createSync({
          ...scope,
          definition: 'granola.meetings',
          connection: { id: 'granola-owner', service: 'granola' },
          destination: { type: 'local', input: {} },
          config: {},
        });
        await run({
          records,
          syncId: sync.id,
          runtime: () => runtime,
          restart: async (registration = granolaMeetings) => {
            await runtime.close();
            runtime = createSyncRuntime({ ...options, definitions: [registration] });
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

test('Granola commits API pages, resumes after failure and restart, and retains disappeared meetings', async () => {
  let fail = true;
  let empty = false;
  let edited = false;
  const cursors: unknown[] = [];
  function listing(query?: JsonObject) {
    cursors.push(query?.cursor ?? null);
    expect(query?.page_size).toBe(10);
    if (empty) {
      return ok({ notes: [], hasMore: false, cursor: null });
    }
    const index = query?.cursor ? 2 : 1;
    return ok({
      notes: [{ id: noteId(index), deleted_at: null }],
      hasMore: index === 1,
      cursor: index === 1 ? 'older' : null,
    });
  }
  function detail(path: string) {
    if (path.endsWith(noteId(2)) && fail) {
      return { status: 429, headers: {}, body: null };
    }
    const value = note(path.endsWith(noteId(1)) ? 1 : 2);
    if (edited && value.id === noteId(1)) {
      value.summary_markdown = 'Edited old meeting';
    }
    return ok(value);
  }
  await fixture({
    get: ({ path, query }) => Promise.resolve(path === '/v1/notes' ? listing(query) : detail(path)),
    run: async (f) => {
      const list = () => f.records.listResources({ ownerId: OWNER_USER_ID, limit: 100, offset: 0 });
      await f.runtime().tick();
      await f.runtime().tick();
      await f.runtime().tick();
      expect(f.runtime().api.syncs(scope)[0]?.status).toBe('retrying');
      expect((await list()).items).toHaveLength(1);
      const first = (await list()).items[0]!;
      expect(
        await f.records.findResource({ ownerId: OWNER_USER_ID, readableId: first.readableId }),
      ).toMatchObject({
        body: `Date: ${occurred}\n\nAttendees: Alice <alice@example.invalid>\n\n## Decisions\nShip **it**.`,
        source: { id: uuid(1), provider: 'granola', kind: 'meeting' },
        sourceCreatedAt: new Date(created).toISOString(),
        sourceUpdatedAt: new Date(created).toISOString(),
        sourceOccurredAt: new Date(occurred).toISOString(),
      });
      await f.restart();
      fail = false;
      f.runtime().api.runNow({ ...scope, id: f.syncId });
      await f.runtime().tick();
      await f.runtime().tick();
      expect((await list()).items).toHaveLength(2);
      expect(cursors).toEqual([null, 'older', 'older']);
      expect((await f.history()).items).toHaveLength(2);
      const poll = async () => {
        f.runtime().api.runNow({ ...scope, id: f.syncId });
        await f.runtime().tick();
        await f.runtime().tick();
        await f.runtime().tick();
      };
      await poll();
      expect(cursors.slice(-2)).toEqual([null, 'older']);
      expect((await f.history()).items).toHaveLength(2);
      edited = true;
      await poll();
      expect((await f.history()).items).toHaveLength(originalAndEditedHistoryCount);
      expect((await list()).items.find((item) => item.source.id === uuid(1))?.readableId).toBe(
        first.readableId,
      );
      empty = true;
      await poll();
      expect((await list()).items).toHaveLength(2);
      expect(
        (await f.records.listResources({ ownerId: 'other', limit: 100, offset: 0 })).items,
      ).toEqual([]);
    },
  });
});

function context(get: SyncContext['provider']['get']): SyncContext {
  return {
    config: {},
    checkpoint: {},
    syncId: 'test',
    signal: new AbortController().signal,
    provider: { get, post: unexpected, action: unexpected },
    assets: {} as SyncContext['assets'],
  };
}

test('empty intermediate API pages continue, while deleted notes leave existing records alone', async () => {
  const first = await stepGranolaMeetings(
    context(async () => ok({ notes: [], hasMore: true, cursor: 'next' })),
  );
  expect(first).toEqual({ records: [], checkpoint: { cursor: 'next' }, complete: false });
  const deleted = await stepGranolaMeetings(
    context(({ path }) =>
      Promise.resolve().then(() => {
        expect(path).toBe('/v1/notes');
        return ok({
          notes: [{ id: noteId(1), deleted_at: created }],
          hasMore: false,
          cursor: null,
        });
      }),
    ),
  );
  expect(deleted).toEqual({ records: [], checkpoint: { cursor: null }, complete: true });
});

test.each([
  'missing-cursor',
  'repeated-cursor',
  'duplicate',
  'foreign-detail',
  'missing-summary',
  'invalid-url',
  'cancelled',
] as const)('Granola rejects %s before committing the page', async (mode) => {
  function listing() {
    const notes = [1, ...(mode === 'duplicate' ? [1] : [])].map((id) => ({
      id: noteId(id),
      deleted_at: null,
    }));
    return ok({
      notes,
      hasMore: mode === 'missing-cursor' || mode === 'repeated-cursor',
      cursor: mode === 'repeated-cursor' ? 'same' : null,
    });
  }
  function detail() {
    const value: JsonObject = note(mode === 'foreign-detail' ? 2 : 1);
    switch (mode) {
      case 'missing-summary':
        delete value.summary_text;
        delete value.summary_markdown;
        break;
      case 'invalid-url':
        value.web_url = 'https://notes.granola.ai/d/not_12345678901234';
        break;
      case 'cancelled':
        throw new DOMException('Cancelled', 'AbortError');
    }
    return ok(value);
  }
  const input = context(({ path }) =>
    Promise.resolve().then(() => (path === '/v1/notes' ? listing() : detail())),
  );
  if (mode === 'repeated-cursor') {
    input.checkpoint = { cursor: 'same' };
  }
  await expect(stepGranolaMeetings(input)).rejects.toThrow();
});

test('API mapping uses the URL UUID, preserves blank summaries, and falls back to plain text', () => {
  expect(granolaRecord(note(1)).id).toBe(uuid(1));
  expect(granolaRecord({ ...note(1), summary_markdown: null }).data.notes).toBe('Plain summary');
  expect(
    granolaRecord({
      ...note(1),
      summary_markdown: '',
      title: null,
      calendar_event: null,
      attendees: [],
    }),
  ).toMatchObject({
    preview: 'Untitled Granola meeting',
    content: { body: '' },
    data: { date: null, sourceOccurredAt: null, notes: '' },
  });
  expect(meetingIdFromUrl(`https://notes.granola.ai/d/${uuid(1).toUpperCase()}`)).toBe(uuid(1));
});

test('API backfill updates an existing MCP meeting under its original sync and readable ID', async () => {
  await fixture({
    get: async ({ path }) =>
      path === '/v1/notes'
        ? ok({
            notes: [
              { id: noteId(1), deleted_at: null },
              { id: noteId(2), deleted_at: null },
            ],
            hasMore: false,
            cursor: null,
          })
        : ok(note(path.endsWith(noteId(1)) ? 1 : 2)),
    run: async (f) => {
      const originalRecord = granolaRecord(note(1));
      const legacy: SyncRegistration = {
        ...granolaMeetings,
        load: () => ({
          step: () =>
            Promise.resolve({
              records: [
                { ...originalRecord, content: { format: 'markdown', body: 'Old MCP summary' } },
              ],
              checkpoint: {},
              complete: true,
            }),
        }),
      };
      await f.restart(legacy);
      await f.runtime().tick();
      await f.runtime().tick();
      const before = (
        await f.records.listResources({ ownerId: OWNER_USER_ID, limit: 100, offset: 0 })
      ).items[0]!;
      await f.restart();
      f.runtime().api.runNow({ ...scope, id: f.syncId });
      await f.runtime().tick();
      await f.runtime().tick();
      const after = (
        await f.records.listResources({ ownerId: OWNER_USER_ID, limit: 100, offset: 0 })
      ).items;
      expect(after).toHaveLength(2);
      expect(after.find((record) => record.source.id === uuid(1))?.readableId).toBe(
        before.readableId,
      );
      expect((await f.history()).items).toHaveLength(originalAndEditedHistoryCount);
      expect(f.runtime().api.syncs(scope)[0]?.id).toBe(f.syncId);
    },
  });
});
