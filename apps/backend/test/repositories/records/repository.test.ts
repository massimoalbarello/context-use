import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import type {
  DeliveredRecord,
  RecordContent,
  RecordDeliveryEnvelope,
} from '#models/records/delivery-contract.generated.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { RecordsService } from '#services/records/service.ts';
import { withAuthTestDatabase } from '../../lib/auth/auth-test-database.ts';

const OWNER_ID = OWNER_USER_ID;
const SECOND_OWNER_ID = 'owner-b';
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
}): DeliveredRecord {
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
  syncId = SYNC_ID,
  recordId = 'record-1',
}: {
  database: SQL;
  syncId?: string;
  recordId?: string;
}) {
  const [record] = await database<
    Array<{ ownerId: string; revision: number; operation: string; markdown: string | null }>
  >`
    select "owner_id" as "ownerId", "revision", "operation", "markdown"
    from "record"
    where "sync_id" = ${syncId} and "record_id" = ${recordId}
  `;
  return record;
}

test('a batch atomically applies owner-bound current records', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await insertOwner({ database, ownerId: OWNER_ID });
      await insertOwner({ database, ownerId: SECOND_OWNER_ID });
      const service = new RecordsService({
        records: new RecordsRepository(database),
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
      expect(await storedRecord({ database })).toMatchObject({
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
      expect(await storedRecord({ database })).toMatchObject({
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
      ).toEqual({ state: 'conflict', reason: 'record_revision' });
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
      expect(await storedRecord({ database })).toMatchObject({
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
      expect(await storedRecord({ database, syncId: SECOND_SYNC_ID })).toMatchObject({
        ownerId: OWNER_ID,
        revision: INITIAL_REVISION,
      });
    },
  });
});

test('one batch can converge multiple changes for the same record on its highest revision', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await insertOwner({ database, ownerId: OWNER_ID });
      await insertSync({ database });
      const service = new RecordsService({
        records: new RecordsRepository(database),
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
      expect(await storedRecord({ database })).toMatchObject({
        revision: STALE_REVISION,
        markdown: 'second revision',
      });
    },
  });
});

test('concurrent retries are harmless and converge on the highest record revision', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await insertOwner({ database, ownerId: OWNER_ID });
      await insertSync({ database });
      const service = new RecordsService({
        records: new RecordsRepository(database),
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
      expect(await storedRecord({ database, recordId })).toMatchObject({
        revision: STALE_REVISION,
        markdown: 'concurrent high revision',
      });
    },
  });
});

test('a record storage failure rolls back the whole batch before a later retry succeeds', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await insertOwner({ database, ownerId: OWNER_ID });
      await insertSync({ database });
      const service = new RecordsService({
        records: new RecordsRepository(database),
        now: () => RECEIVED_AT,
      });
      await database`
        create trigger "record_test_reject_second_record"
        before insert on "record"
        when new."record_id" = 'rejected-record'
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
