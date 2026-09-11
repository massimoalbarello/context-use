import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#db/client.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import type { Storage } from '#lib/storage/storage.ts';
import type { DeliveredRecord } from '#models/records/delivery-contract.generated.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { RecordsService } from '#services/records/service.ts';
import { withRecordTestDatabase } from './database.ts';
import {
  activeRecord,
  CURRENT_REVISION,
  DELETED_REVISION,
  deletedRecord,
  digest,
  insertOwner,
  insertSync,
  OWNER_ID,
  RECEIVED_AT,
  recordCount,
  SECOND_OWNER_ID,
  SYNC_ID,
} from './fixtures.ts';

function service({ sql, storage }: { sql: SQL; storage: Storage }) {
  return new RecordsService({
    records: new RecordsRepository({ sql, storage }),
    now: () => RECEIVED_AT,
  });
}

function input(records: DeliveredRecord[]) {
  return {
    ownerId: OWNER_ID,
    syncId: SYNC_ID,
    envelope: { version: 1 as const, batchId: Bun.randomUUIDv7(), records },
  };
}

async function setup(database: SQL) {
  await insertOwner({ database, ownerId: OWNER_ID });
  await insertSync({ database });
}

function fileKeys(dataFolder: string) {
  return Array.fromAsync(new Bun.Glob('**/*.json').scan({ cwd: join(dataFolder, 'objects') }));
}

async function storedReference(database: SQL) {
  const [row] = await database<
    Array<{ storageKey: string; readableId: string; contentHash: string; sizeBytes: number }>
  >`
    select "storage_key" as "storageKey", "readable_id" as "readableId", "content_hash" as "contentHash", "size_bytes" as "sizeBytes"
    from "record" where "owner_id" = ${OWNER_ID} and "sync_id" = ${SYNC_ID}
  `;
  return row!;
}

function gate() {
  return Promise.withResolvers<void>();
}

test('canonical files preserve Markdown and all accepted metadata across reopen; SQL stores identity metadata and file references', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await setup(database);
      const storage = createLocalStorage({ dataFolder });
      const initial = activeRecord({
        eventId: 'original',
        body: '# café\r\n\r\n[ref]: https://example.invalid\n\n  original spacing  \n',
      });
      expect(await service({ sql: database, storage }).accept(input([initial]))).toEqual({
        state: 'accepted',
      });
      const originalReference = await storedReference(database);
      const snapshot = await storage.file(originalReference.storageKey).text().then(JSON.parse);
      expect(snapshot).toEqual({
        version: 1,
        ownerId: OWNER_ID,
        syncId: SYNC_ID,
        readableId: originalReference.readableId,
        receivedAt: RECEIVED_AT.toISOString(),
        record: initial,
      });
      expect(originalReference.storageKey).toStartWith(`${OWNER_ID}/records/${SYNC_ID}/`);
      const columns = await database<Array<{ name: string }>>`pragma table_info('record')`;
      expect(columns.map(({ name }) => name).sort()).toEqual(
        [
          'owner_id',
          'sync_id',
          'source_id',
          'kind',
          'record_id',
          'title',
          'provider',
          'source_created_at',
          'source_updated_at',
          'readable_id',
          'revision',
          'operation',
          'revision_hash',
          'storage_key',
          'content_hash',
          'size_bytes',
          'created_at',
          'updated_at',
        ].sort(),
      );
      const reopened = await createSqliteDatabase({ dataFolder });
      try {
        const reader = service({ sql: reopened, storage: createLocalStorage({ dataFolder }) });
        const resource = await reader.findResource({
          ownerId: OWNER_ID,
          readableId: originalReference.readableId,
        });
        expect(resource?.record).toEqual(initial);
        expect(resource?.markdown).toBe(initial.content.body);
        const retry = { ...initial, eventId: Bun.randomUUIDv7() };
        expect(await reader.accept(input([retry]))).toEqual({ state: 'accepted' });
        expect(await storedReference(database)).toEqual(originalReference);
        expect(await fileKeys(dataFolder)).toEqual([originalReference.storageKey]);
        // Listing uses SQL metadata, while content reads require the canonical file.
        await storage.delete(originalReference.storageKey);
        await expect(
          reader.findResource({ ownerId: OWNER_ID, readableId: originalReference.readableId }),
        ).rejects.toThrow('is missing');
        expect(await reader.listResources({ ownerId: OWNER_ID, limit: 10, offset: 0 })).toEqual({
          items: [
            {
              readableId: originalReference.readableId,
              title: initial.content.title,
              provider: initial.provider,
              sourceCreatedAt: initial.content.sourceCreatedAt ?? null,
              sourceUpdatedAt: initial.content.sourceUpdatedAt ?? null,
              kind: initial.kind,
              recordId: initial.id,
              sync: { readableId: 'receiver-a', name: 'receiver-a' },
              createdAt: RECEIVED_AT.toISOString(),
              updatedAt: RECEIVED_AT.toISOString(),
            },
          ],
          nextOffset: null,
          filterOptions: { providers: [initial.provider], kinds: [initial.kind] },
        });
        expect(
          await reader.findResource({
            ownerId: SECOND_OWNER_ID,
            readableId: originalReference.readableId,
          }),
        ).toBeNull();
      } finally {
        await reopened.close();
      }
    },
  });
});

test('source, kind, and record ID keep records and their revisions independent within a sync', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await setup(database);
      const records = service({ sql: database, storage: createLocalStorage({ dataFolder }) });
      const initial = [
        activeRecord({ eventId: 'initial' }),
        { ...activeRecord({ eventId: 'other-source' }), sourceId: 'other.example' },
        { ...activeRecord({ eventId: 'other-kind' }), kind: 'issue' },
        activeRecord({ eventId: 'other-record', recordId: 'record-2' }),
      ];
      expect(await records.accept(input(initial))).toEqual({ state: 'accepted' });
      const updated = {
        ...activeRecord({ eventId: 'update', revision: CURRENT_REVISION, body: 'updated source' }),
        sourceId: 'other.example',
      };
      expect(await records.accept(input([updated]))).toEqual({ state: 'accepted' });
      const list = await records.listResources({ ownerId: OWNER_ID, limit: 10, offset: 0 });
      expect(list.items).toHaveLength(initial.length);
      const stored = await Promise.all(
        list.items.map(({ readableId }) => records.findResource({ ownerId: OWNER_ID, readableId })),
      );
      expect(stored.map((record) => record?.record)).toEqual(
        expect.arrayContaining([initial[0], updated, initial[2], initial[3]]),
      );
    },
  });
});

test('equal revisions compare all canonical metadata independently of JSON property order', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await setup(database);
      const records = service({ sql: database, storage: createLocalStorage({ dataFolder }) });
      const initial = activeRecord({ eventId: 'initial' });
      expect(await records.accept(input([initial]))).toEqual({ state: 'accepted' });
      const originalReference = await storedReference(database);
      const reordered = {
        ...initial,
        content: { ...initial.content, attributes: { nested: { enabled: true, answer: 42 } } },
      };
      expect(await records.accept(input([reordered]))).toEqual({ state: 'accepted' });
      const conflicts: DeliveredRecord[] = [
        { ...initial, provider: 'another-provider' },
        { ...initial, committedAt: '2026-09-09T00:00:00Z' },
        { ...initial, content: { ...initial.content, sourceUrl: 'https://changed.invalid' } },
        { ...initial, content: { ...initial.content, participants: [] } },
        { ...initial, content: { ...initial.content, attributes: { changed: true } } },
      ];
      for (const conflict of conflicts) {
        expect(
          await records.accept(
            input([activeRecord({ eventId: 'rollback', recordId: 'must-rollback' }), conflict]),
          ),
        ).toEqual({ state: 'conflict' });
        expect(await storedReference(database)).toEqual(originalReference);
        expect(await recordCount(database)).toBe(1);
        expect(await fileKeys(dataFolder)).toEqual([originalReference.storageKey]);
      }
    },
  });
});

test('partial writes and SQL failures remove every unpublished file, then the exact batch can retry', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await setup(database);
      const batch = input([
        activeRecord({ eventId: 'first' }),
        activeRecord({ eventId: 'second', recordId: 'second' }),
      ]);
      class PartialStorage extends LocalStorage {
        writes = 0;
        // biome-ignore lint/complexity/useMaxParams: implements Storage.write
        override async write(key: string, data: Blob) {
          this.writes += 1;
          if (this.writes === 2) {
            await super.write(key, new Blob(['partial']));
            throw new Error('disk write failed');
          }
          return super.write(key, data);
        }
      }
      const storage = new PartialStorage(join(dataFolder, 'objects'));
      const records = service({ sql: database, storage });
      await expect(records.accept(batch)).rejects.toThrow('disk write failed');
      expect(await recordCount(database)).toBe(0);
      expect(await fileKeys(dataFolder)).toEqual([]);
      await database`create trigger reject_record before insert on "record"
      when new."readable_id" like 'pull-request-second-%' begin select raise(abort, 'SQL publication failed'); end`;
      await expect(records.accept(batch)).rejects.toThrow('SQL publication failed');
      expect(await recordCount(database)).toBe(0);
      expect(await fileKeys(dataFolder)).toEqual([]);
      await database`drop trigger reject_record`;
      expect(await records.accept(batch)).toEqual({ state: 'accepted' });
      expect(await recordCount(database)).toBe(2);
      expect(await fileKeys(dataFolder)).toHaveLength(2);
    },
  });
});

test('staged files stay invisible and revocation before publication rejects the whole batch', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await setup(database);
      const staged = gate();
      const resume = gate();
      class PausedStorage extends LocalStorage {
        // biome-ignore lint/complexity/useMaxParams: implements Storage.write
        override async write(key: string, data: Blob) {
          const bytes = await super.write(key, data);
          staged.resolve();
          await resume.promise;
          return bytes;
        }
      }
      const storage = new PausedStorage(join(dataFolder, 'objects'));
      const records = service({ sql: database, storage });
      const accepting = records.accept(input([activeRecord({ eventId: 'paused' })]));
      try {
        await staged.promise;
        expect(await fileKeys(dataFolder)).toHaveLength(1);
        expect(await records.listResources({ ownerId: OWNER_ID, limit: 10, offset: 0 })).toEqual({
          items: [],
          nextOffset: null,
          filterOptions: { providers: [], kinds: [] },
        });
        await database`update "record_sync" set "revoked_at" = ${RECEIVED_AT.toISOString()} where "id" = ${SYNC_ID}`;
      } finally {
        resume.resolve();
      }
      expect(await accepting).toEqual({ state: 'inactive_sync' });
      expect(await recordCount(database)).toBe(0);
      expect(await fileKeys(dataFolder)).toEqual([]);
    },
  });
});

test('separate database connections serialize revisions and retain tombstones against delayed deliveries', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await setup(database);
      const otherDatabase = await createSqliteDatabase({ dataFolder });
      const storage = createLocalStorage({ dataFolder });
      const first = service({ sql: database, storage });
      const second = service({ sql: otherDatabase, storage });
      try {
        const initial = input([activeRecord({ eventId: 'retry' })]);
        expect(await Promise.all([first.accept(initial), second.accept(initial)])).toEqual([
          { state: 'accepted' },
          { state: 'accepted' },
        ]);
        expect(await fileKeys(dataFolder)).toHaveLength(1);
        const originalReference = await storedReference(database);
        const newest = activeRecord({ eventId: 'newest', revision: CURRENT_REVISION });
        const deletion = deletedRecord({ eventId: 'deleted', revision: DELETED_REVISION });
        expect(
          await Promise.all([first.accept(input([newest])), second.accept(input([deletion]))]),
        ).toEqual([{ state: 'accepted' }, { state: 'accepted' }]);
        expect(await first.accept(initial)).toEqual({ state: 'accepted' });
        expect(
          await first.findResource({ ownerId: OWNER_ID, readableId: originalReference.readableId }),
        ).toBeNull();
        expect(await first.listResources({ ownerId: OWNER_ID, limit: 10, offset: 0 })).toEqual({
          items: [],
          nextOffset: null,
          filterOptions: { providers: [], kinds: [] },
        });
        const deletedReference = await storedReference(database);
        expect(
          await storage.file(deletedReference.storageKey).text().then(JSON.parse),
        ).toMatchObject({
          record: deletion,
        });
        const restore = activeRecord({ eventId: 'restore', revision: DELETED_REVISION + 1 });
        expect(await second.accept(input([restore]))).toEqual({ state: 'accepted' });
        expect((await storedReference(database)).readableId).toBe(originalReference.readableId);
        expect(
          (
            await first.findResource({
              ownerId: OWNER_ID,
              readableId: originalReference.readableId,
            })
          )?.record,
        ).toEqual(restore);
      } finally {
        await otherDatabase.close();
      }
    },
  });
});

test('integrity checks reject truncation, equal-size tampering, invalid schema, and catalog/file identity mismatch', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await setup(database);
      const storage = createLocalStorage({ dataFolder });
      const records = service({ sql: database, storage });
      expect(await records.accept(input([activeRecord({ eventId: 'integrity' })]))).toEqual({
        state: 'accepted',
      });
      const original = await storedReference(database);
      const json = await storage.file(original.storageKey).text();
      const find = () =>
        records.findResource({ ownerId: OWNER_ID, readableId: original.readableId });
      await storage.write(original.storageKey, new Blob([json.slice(1)]));
      await expect(find()).rejects.toThrow('integrity check');
      await storage.write(original.storageKey, new Blob([json.replace('initial', 'changed')]));
      await expect(find()).rejects.toThrow('integrity check');
      for (const snapshot of [
        { ...JSON.parse(json), record: { ...JSON.parse(json).record, content: { body: 123 } } },
        { ...JSON.parse(json), ownerId: SECOND_OWNER_ID },
      ]) {
        const invalid = JSON.stringify(snapshot);
        await storage.write(original.storageKey, new Blob([invalid]));
        // Even a structurally valid checksum cannot bypass schema or owner/identity validation.
        await database`update "record" set "content_hash" = ${digest(invalid)}, "size_bytes" = ${Buffer.byteLength(invalid)} where "storage_key" = ${original.storageKey}`;
        await expect(find()).rejects.toThrow();
      }
      expect(
        await records.findResource({ ownerId: SECOND_OWNER_ID, readableId: original.readableId }),
      ).toBeNull();
    },
  });
});

test('a reader keeps a verified immutable revision while another repository publishes its replacement', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await setup(database);
      const storage = createLocalStorage({ dataFolder });
      const writer = service({ sql: database, storage });
      const initial = activeRecord({ eventId: 'initial' });
      expect(await writer.accept(input([initial]))).toEqual({ state: 'accepted' });
      const originalReference = await storedReference(database);
      const reading = gate();
      const resume = gate();
      class PausedReadStorage extends LocalStorage {
        override async exists(key: string) {
          reading.resolve();
          await resume.promise;
          return super.exists(key);
        }
      }
      const reader = service({
        sql: database,
        storage: new PausedReadStorage(join(dataFolder, 'objects')),
      });
      const pendingRead = reader.findResource({
        ownerId: OWNER_ID,
        readableId: originalReference.readableId,
      });
      const update = activeRecord({
        eventId: 'replacement',
        revision: CURRENT_REVISION,
        body: 'replacement Markdown',
      });
      try {
        await reading.promise;
        expect(await writer.accept(input([update]))).toEqual({ state: 'accepted' });
      } finally {
        resume.resolve();
      }
      expect((await pendingRead)?.record).toEqual(initial);
      expect(
        (await writer.findResource({ ownerId: OWNER_ID, readableId: originalReference.readableId }))
          ?.record,
      ).toEqual(update);
      expect(await storage.exists(originalReference.storageKey)).toBe(true);
    },
  });
});

test('cleanup failure is reported without deleting published revisions, and an exact retry is safe', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await setup(database);
      class CleanupFailureStorage extends LocalStorage {
        failCleanup = true;
        override delete(key: string): Promise<void> {
          if (this.failCleanup) {
            return Promise.reject(new Error('disk cleanup failed'));
          }
          return super.delete(key);
        }
      }
      const storage = new CleanupFailureStorage(join(dataFolder, 'objects'));
      const records = service({ sql: database, storage });
      const first = activeRecord({ eventId: 'first' });
      const latest = activeRecord({ eventId: 'latest', revision: CURRENT_REVISION });
      const batch = input([first, latest]);
      await expect(records.accept(batch)).rejects.toThrow(
        'Could not remove unpublished record files',
      );
      const published = await storedReference(database);
      expect(
        (await records.findResource({ ownerId: OWNER_ID, readableId: published.readableId }))
          ?.record,
      ).toEqual(latest);
      const beforeRetry = await fileKeys(dataFolder);
      expect(beforeRetry).toHaveLength(2);
      storage.failCleanup = false;
      expect(await records.accept(batch)).toEqual({ state: 'accepted' });
      expect(await storedReference(database)).toEqual(published);
      expect((await fileKeys(dataFolder)).sort()).toEqual(beforeRetry.sort());
    },
  });
});

test('a delayed staged revision cannot resurrect a tombstone committed by another connection', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await setup(database);
      const otherDatabase = await createSqliteDatabase({ dataFolder });
      const staged = gate();
      const resume = gate();
      class DelayedStorage extends LocalStorage {
        // biome-ignore lint/complexity/useMaxParams: implements Storage.write
        override async write(key: string, data: Blob) {
          const size = await super.write(key, data);
          staged.resolve();
          await resume.promise;
          return size;
        }
      }
      const storage = createLocalStorage({ dataFolder });
      const delayed = service({
        sql: database,
        storage: new DelayedStorage(join(dataFolder, 'objects')),
      });
      const writer = service({ sql: otherDatabase, storage });
      const accepting = delayed.accept(input([activeRecord({ eventId: 'delayed' })]));
      try {
        await staged.promise;
        const deletion = deletedRecord({ eventId: 'tombstone', revision: DELETED_REVISION });
        expect(await writer.accept(input([deletion]))).toEqual({ state: 'accepted' });
        resume.resolve();
        expect(await accepting).toEqual({ state: 'accepted' });
        const published = await storedReference(database);
        expect(await fileKeys(dataFolder)).toEqual([published.storageKey]);
        expect(await storage.file(published.storageKey).text().then(JSON.parse)).toMatchObject({
          record: deletion,
        });
        expect(
          await delayed.findResource({ ownerId: OWNER_ID, readableId: published.readableId }),
        ).toBeNull();
      } finally {
        resume.resolve();
        await accepting;
        await otherDatabase.close();
      }
    },
  });
});

test('concurrent conflicting revisions through separate repositories publish exactly one complete batch', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await setup(database);
      const otherDatabase = await createSqliteDatabase({ dataFolder });
      const storage = createLocalStorage({ dataFolder });
      try {
        const first = service({ sql: database, storage });
        const second = service({ sql: otherDatabase, storage });
        const results = await Promise.all([
          first.accept(
            input([
              activeRecord({ eventId: 'left', body: 'left' }),
              activeRecord({ eventId: 'left-only', recordId: 'left-only' }),
            ]),
          ),
          second.accept(
            input([
              activeRecord({ eventId: 'right-only', recordId: 'right-only' }),
              activeRecord({ eventId: 'right', body: 'right' }),
            ]),
          ),
        ]);
        expect(results.map(({ state }) => state).sort()).toEqual(['accepted', 'conflict']);
        expect(await recordCount(database)).toBe(2);
        expect(await fileKeys(dataFolder)).toHaveLength(2);
        const list = await first.listResources({ ownerId: OWNER_ID, limit: 10, offset: 0 });
        const winner = results[0]?.state === 'accepted' ? 'left' : 'right';
        expect(list.items.map(({ recordId }) => recordId).sort()).toEqual(
          [`${winner}-only`, 'record-1'].sort(),
        );
      } finally {
        await otherDatabase.close();
      }
    },
  });
});
