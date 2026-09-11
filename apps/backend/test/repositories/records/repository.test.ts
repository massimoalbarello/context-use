import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#db/client.ts';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import type { Storage } from '#lib/storage/storage.ts';
import type {
  DeliveredRecord,
  RecordContent,
  RecordDeliveryEnvelope,
} from '#models/records/delivery-contract.generated.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { RecordsService } from '#services/records/service.ts';
import { withRecordTestDatabase } from './database.ts';

const OWNER_ID = OWNER_USER_ID;
const SYNC_ID = '01991f43-0c00-7000-8000-000000000001';
const SYNC_READABLE_ID = 'receiver-a';
const SECOND_SYNC_ID = '01991f43-0c00-7000-8000-000000000002';
const SECOND_SYNC_READABLE_ID = 'receiver-b';
const RECEIVED_AT = new Date('2026-09-08T08:00:00.000Z');
const INITIAL_REVISION = 1;
const STALE_REVISION = 2;
const CURRENT_REVISION = 3;
const DELETED_REVISION = 4;

function digest(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function content(body: string): RecordContent {
  return {
    body,
    sourceUrl: 'https://example.invalid/records/record-1',
    sourceCreatedAt: '2025-01-02T03:04:05-04:00',
    sourceUpdatedAt: '2026-08-09T10:11:12+05:30',
    participants: [
      {
        identities: [{ namespace: 'github', id: 'octocat' }],
        roles: ['author'],
        name: 'Octo Cat',
      },
    ],
    attributes: { nested: { answer: 42, enabled: true } },
  };
}

function activeRecord({
  eventId,
  recordId = 'record-1',
  revision = INITIAL_REVISION,
  body = 'initial Markdown body',
}: {
  eventId: string;
  recordId?: string;
  revision?: number;
  body?: string;
}): Exclude<DeliveredRecord, { operation: 'deleted' }> {
  const recordContent = content(body);
  return {
    eventId,
    provider: 'github',
    sourceId: 'github.example',
    kind: 'pull-request',
    id: recordId,
    revision,
    operation: revision === INITIAL_REVISION ? 'added' : 'updated',
    contentHash: digest(JSON.stringify(recordContent)),
    committedAt: '2026-08-09T10:11:12+05:30',
    content: recordContent,
  };
}

function deletedRecord({ eventId, revision }: { eventId: string; revision: number }) {
  return {
    eventId,
    provider: 'github',
    sourceId: 'github.example',
    kind: 'pull-request',
    id: 'record-1',
    revision,
    operation: 'deleted',
    contentHash: digest('deleted'),
    committedAt: '2026-09-01T02:03:04-07:00',
  } satisfies DeliveredRecord;
}

function envelope({
  batchId,
  records,
}: {
  batchId: string;
  records: DeliveredRecord[];
}): RecordDeliveryEnvelope {
  return { version: 1, batchId, records };
}

async function insertOwner({
  database,
  ownerId,
}: {
  database: SQL;
  ownerId: string;
}): Promise<void> {
  const timestamp = RECEIVED_AT.toISOString();
  await database`
    insert into "auth_user"
      ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values (${ownerId}, ${ownerId}, ${`${ownerId}@example.invalid`}, 1, ${timestamp}, ${timestamp})
  `;
}

async function insertSync({
  database,
  syncId = SYNC_ID,
  readableId = SYNC_READABLE_ID,
  ownerId = OWNER_ID,
}: {
  database: SQL;
  syncId?: string;
  readableId?: string;
  ownerId?: string;
}): Promise<void> {
  await database`
    insert into "record_sync"
      ("id", "owner_id", "readable_id", "name", "api_key_sha256", "created_at")
    values
      (${syncId}, ${ownerId}, ${readableId}, ${readableId}, ${digest(`${syncId}-key`)},
       ${RECEIVED_AT.toISOString()})
  `;
}

async function recordCount(database: SQL): Promise<number> {
  const [count] = await database<Array<{ total: number }>>`
    select count(*) as "total" from "record"
  `;
  return Number(count?.total ?? 0);
}

async function storedRecord({
  database,
  storage,
  syncId = SYNC_ID,
  recordId = 'record-1',
}: {
  database: SQL;
  storage: Storage;
  syncId?: string;
  recordId?: string;
}) {
  const [stored] = await database<Array<{ ownerId: string; storageKey: string }>>`
    select "owner_id" as "ownerId", "storage_key" as "storageKey" from "record"
    where "owner_id" = ${OWNER_ID} and "sync_id" = ${syncId}
      and "source_id" = 'github.example' and "kind" = 'pull-request' and "record_id" = ${recordId}
  `;
  if (!stored) {
    return undefined;
  }
  const record = await storage.file(stored.storageKey).text().then(JSON.parse);
  return {
    ownerId: stored.ownerId,
    revision: record.revision,
    operation: record.operation,
    markdown: record.content?.body ?? null,
  };
}

function service({ sql, storage }: { sql: SQL; storage: Storage }) {
  return new RecordsService({
    records: new RecordsRepository(sql),
    storage,
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

test('a batch atomically applies owner-bound current records', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      const storage = createLocalStorage({ dataFolder });
      await insertOwner({ database, ownerId: OWNER_ID });
      const service = new RecordsService({
        records: new RecordsRepository(database),
        storage,
        now: () => RECEIVED_AT,
      });

      const initial = activeRecord({ eventId: 'event-initial' });
      const firstEnvelope = envelope({ batchId: 'batch-initial', records: [initial] });
      expect(
        await service.accept({ syncId: SYNC_ID, ownerId: OWNER_ID, envelope: firstEnvelope }),
      ).toEqual({ state: 'inactive_sync' });
      await insertSync({ database });

      expect(
        await service.accept({ syncId: SYNC_ID, ownerId: OWNER_ID, envelope: firstEnvelope }),
      ).toEqual({ state: 'accepted' });
      expect(await recordCount(database)).toBe(1);

      expect(
        await service.accept({ syncId: SYNC_ID, ownerId: OWNER_ID, envelope: firstEnvelope }),
      ).toEqual({ state: 'accepted' });
      expect(await recordCount(database)).toBe(1);
      expect(await storedRecord({ database, storage })).toMatchObject({
        ownerId: OWNER_ID,
        revision: INITIAL_REVISION,
        operation: 'added',
        markdown: 'initial Markdown body',
      });

      const current = activeRecord({
        eventId: 'event-current',
        revision: CURRENT_REVISION,
        body: 'newest Markdown body',
      });
      expect(
        await service.accept({
          syncId: SYNC_ID,
          ownerId: OWNER_ID,
          envelope: envelope({ batchId: 'batch-current', records: [current] }),
        }),
      ).toEqual({ state: 'accepted' });
      expect(
        await service.accept({
          syncId: SYNC_ID,
          ownerId: OWNER_ID,
          envelope: envelope({
            batchId: 'batch-stale',
            records: [
              activeRecord({
                eventId: 'event-stale',
                revision: STALE_REVISION,
                body: 'late older material',
              }),
            ],
          }),
        }),
      ).toEqual({ state: 'accepted' });
      expect(await storedRecord({ database, storage })).toMatchObject({
        revision: CURRENT_REVISION,
        markdown: 'newest Markdown body',
      });

      const beforeConflict = await recordCount(database);
      expect(
        await service.accept({
          syncId: SYNC_ID,
          ownerId: OWNER_ID,
          envelope: envelope({
            batchId: 'batch-conflict',
            records: [
              activeRecord({ eventId: 'event-must-rollback', recordId: 'must-rollback' }),
              activeRecord({
                eventId: 'event-revision-conflict',
                revision: CURRENT_REVISION,
                body: 'conflicting current revision',
              }),
            ],
          }),
        }),
      ).toEqual({ state: 'conflict' });
      expect(await recordCount(database)).toBe(beforeConflict);

      expect(
        await service.accept({
          syncId: SYNC_ID,
          ownerId: OWNER_ID,
          envelope: envelope({
            batchId: 'batch-delete',
            records: [deletedRecord({ eventId: 'event-delete', revision: DELETED_REVISION })],
          }),
        }),
      ).toEqual({ state: 'accepted' });
      expect(await recordCount(database)).toBe(1);
      expect(
        await service.accept({
          syncId: SYNC_ID,
          ownerId: OWNER_ID,
          envelope: envelope({
            batchId: 'batch-stale-after-delete',
            records: [
              activeRecord({
                eventId: 'event-stale-after-delete',
                revision: STALE_REVISION,
                body: 'late older material',
              }),
            ],
          }),
        }),
      ).toEqual({ state: 'accepted' });
      expect(await storedRecord({ database, storage })).toMatchObject({
        revision: DELETED_REVISION,
        operation: 'deleted',
        markdown: null,
      });

      await insertSync({
        database,
        syncId: SECOND_SYNC_ID,
        readableId: SECOND_SYNC_READABLE_ID,
      });
      expect(
        await service.accept({
          syncId: SECOND_SYNC_ID,
          ownerId: OWNER_ID,
          envelope: firstEnvelope,
        }),
      ).toEqual({ state: 'accepted' });
      expect(await storedRecord({ database, storage, syncId: SECOND_SYNC_ID })).toMatchObject({
        ownerId: OWNER_ID,
        revision: INITIAL_REVISION,
      });
    },
  });
});

test('one batch can converge multiple changes for the same record on its highest revision', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      const storage = createLocalStorage({ dataFolder });
      await insertOwner({ database, ownerId: OWNER_ID });
      await insertSync({ database });
      const service = new RecordsService({
        records: new RecordsRepository(database),
        storage,
        now: () => RECEIVED_AT,
      });

      expect(
        await service.accept({
          syncId: SYNC_ID,
          ownerId: OWNER_ID,
          envelope: envelope({
            batchId: 'batch-multiple-revisions',
            records: [
              activeRecord({ eventId: 'event-revision-one', body: 'first revision' }),
              activeRecord({
                eventId: 'event-revision-two',
                revision: STALE_REVISION,
                body: 'second revision',
              }),
            ],
          }),
        }),
      ).toEqual({ state: 'accepted' });
      expect(await storedRecord({ database, storage })).toMatchObject({
        revision: STALE_REVISION,
        markdown: 'second revision',
      });
    },
  });
});

test('concurrent retries are harmless and converge on the highest record revision', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      const storage = createLocalStorage({ dataFolder });
      await insertOwner({ database, ownerId: OWNER_ID });
      await insertSync({ database });
      const service = new RecordsService({
        records: new RecordsRepository(database),
        storage,
        now: () => RECEIVED_AT,
      });
      const duplicateInput = {
        syncId: SYNC_ID,
        ownerId: OWNER_ID,
        envelope: envelope({
          batchId: 'batch-concurrent-duplicate',
          records: [activeRecord({ eventId: 'event-concurrent-duplicate' })],
        }),
      } as const;
      expect(
        await Promise.all([service.accept(duplicateInput), service.accept(duplicateInput)]),
      ).toEqual([{ state: 'accepted' }, { state: 'accepted' }]);

      const recordId = 'concurrent-revisions';
      await Promise.all([
        service.accept({
          syncId: SYNC_ID,
          ownerId: OWNER_ID,
          envelope: envelope({
            batchId: 'batch-concurrent-low',
            records: [
              activeRecord({
                eventId: 'event-concurrent-low',
                recordId,
                revision: INITIAL_REVISION,
                body: 'concurrent low revision',
              }),
            ],
          }),
        }),
        service.accept({
          syncId: SYNC_ID,
          ownerId: OWNER_ID,
          envelope: envelope({
            batchId: 'batch-concurrent-high',
            records: [
              activeRecord({
                eventId: 'event-concurrent-high',
                recordId,
                revision: STALE_REVISION,
                body: 'concurrent high revision',
              }),
            ],
          }),
        }),
      ]);
      expect(await storedRecord({ database, storage, recordId })).toMatchObject({
        revision: STALE_REVISION,
        markdown: 'concurrent high revision',
      });
    },
  });
});

test('record files preserve the full delivery across reopen and reject missing or corrupted content', async () => {
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
      expect(snapshot).toEqual(initial);
      expect(originalReference.storageKey).toStartWith(`${OWNER_ID}/records/${SYNC_ID}/`);
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
        const json = JSON.stringify(initial);
        for (const damaged of [json.slice(1), json.replace('github', 'gitlab')]) {
          await storage.write(originalReference.storageKey, new Blob([damaged]));
          await expect(
            reader.findResource({ ownerId: OWNER_ID, readableId: originalReference.readableId }),
          ).rejects.toThrow('integrity check');
        }
        // Listing uses SQL metadata, while content reads require the canonical file.
        await storage.delete(originalReference.storageKey);
        await expect(
          reader.findResource({ ownerId: OWNER_ID, readableId: originalReference.readableId }),
        ).rejects.toThrow('is missing');
        const list = await reader.listResources({ ownerId: OWNER_ID, limit: 10, offset: 0 });
        expect(list.items.map(({ readableId }) => readableId)).toEqual([
          originalReference.readableId,
        ]);
      } finally {
        await reopened.close();
      }
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
      const secondAttemptLastWrite = batch.envelope.records.length * 2;
      class PartialStorage extends LocalStorage {
        writes = 0;
        // biome-ignore lint/complexity/useMaxParams: implements Storage.write
        override async write(key: string, data: Blob) {
          this.writes += 1;
          if (this.writes === 2) {
            await super.write(key, new Blob(['partial']));
            throw new Error('disk write failed');
          }
          if (this.writes === secondAttemptLastWrite) {
            return super.write(key, new Blob(['partial']));
          }
          return super.write(key, data);
        }
      }
      const storage = new PartialStorage(join(dataFolder, 'objects'));
      const records = service({ sql: database, storage });
      for (const error of ['disk write failed', 'Record file was not fully written']) {
        await expect(records.accept(batch)).rejects.toThrow(error);
        expect(await recordCount(database)).toBe(0);
        expect(await fileKeys(dataFolder)).toEqual([]);
      }
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
        expect(await storage.file(published.storageKey).text().then(JSON.parse)).toEqual(deletion);
        expect(
          await delayed.findResource({ ownerId: OWNER_ID, readableId: published.readableId }),
        ).toBeNull();
        const restored = activeRecord({ eventId: 'restore', revision: DELETED_REVISION + 1 });
        expect(await writer.accept(input([restored]))).toEqual({ state: 'accepted' });
        expect(
          (await writer.findResource({ ownerId: OWNER_ID, readableId: published.readableId }))
            ?.record,
        ).toEqual(restored);
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
