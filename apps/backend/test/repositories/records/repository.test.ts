import { expect, test } from 'bun:test';
import { createLocalStorage } from '#lib/storage/client.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { RecordsService } from '#services/records/service.ts';
import { withRecordTestDatabase } from './database.ts';
import {
  activeRecord,
  CURRENT_REVISION,
  DELETED_REVISION,
  deletedRecord,
  envelope,
  INITIAL_REVISION,
  insertOwner,
  insertSync,
  OWNER_ID,
  RECEIVED_AT,
  recordCount,
  SECOND_OWNER_ID,
  SECOND_SYNC_ID,
  SECOND_SYNC_READABLE_ID,
  STALE_REVISION,
  SYNC_ID,
  storedRecord,
} from './fixtures.ts';

test('a batch atomically applies owner-bound current records', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      const storage = createLocalStorage({ dataFolder });
      await insertOwner({ database, ownerId: OWNER_ID });
      await insertOwner({ database, ownerId: SECOND_OWNER_ID });
      const service = new RecordsService({
        records: new RecordsRepository({ sql: database, storage }),
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
        records: new RecordsRepository({ sql: database, storage }),
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
        records: new RecordsRepository({ sql: database, storage }),
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

test('a record storage failure rolls back the whole batch before a later retry succeeds', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      const storage = createLocalStorage({ dataFolder });
      await insertOwner({ database, ownerId: OWNER_ID });
      await insertSync({ database });
      const service = new RecordsService({
        records: new RecordsRepository({ sql: database, storage }),
        now: () => RECEIVED_AT,
      });
      await database`
        create trigger "record_test_reject_second_record"
        before insert on "record_delivery_head"
        when new."readable_id" like 'pull-request-rejected-record-%'
        begin
          select raise(abort, 'simulated record storage failure');
        end
      `;

      const input = {
        syncId: SYNC_ID,
        ownerId: OWNER_ID,
        envelope: envelope({
          batchId: 'batch-durable-retry',
          records: [
            activeRecord({ eventId: 'event-durable-retry' }),
            activeRecord({ eventId: 'event-rejected', recordId: 'rejected-record' }),
          ],
        }),
      } as const;
      await expect(service.accept(input)).rejects.toThrow('simulated record storage failure');
      expect(await recordCount(database)).toBe(0);

      await database`drop trigger "record_test_reject_second_record"`;
      expect(await service.accept(input)).toEqual({ state: 'accepted' });
      expect(await recordCount(database)).toBe(2);
    },
  });
});
