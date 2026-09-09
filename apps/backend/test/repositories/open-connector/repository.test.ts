import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import type {
  OpenConnectorDeliveryEnvelope,
  OpenConnectorDeliveryRecord,
  OpenConnectorRecordContent,
} from '#models/open-connector/model.ts';
import { canonicalOpenConnectorContent } from '#models/open-connector/model.ts';
import { OpenConnectorRecordsRepository } from '#repositories/open-connector/repository.ts';
import { OpenConnectorRecordsService } from '#services/open-connector/service.ts';
import { withAuthTestDatabase } from '../../lib/auth/auth-test-database.ts';

const OWNER_ID = OWNER_USER_ID;
const SECOND_OWNER_ID = 'owner-b';
const INTEGRATION_ID = 'receiver-a';
const RECEIVED_AT = new Date('2026-09-08T08:00:00.000Z');
const INITIAL_REVISION = 1;
const STALE_REVISION = 2;
const CURRENT_REVISION = 3;
const DELETED_REVISION = 4;
const SHA256_HEX_LENGTH = 64;
const SHARED_DELIVERY_API_KEY = 'shared-key-candidate-0123456789abc';

const ownerRegistration = {
  state: async () => ({ ownerExists: true, passkeyExists: true }),
};

function digest(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function content(body: string): OpenConnectorRecordContent {
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
  body = 'initial searchable material',
}: {
  eventId: string;
  recordId?: string;
  revision?: number;
  body?: string;
}): OpenConnectorDeliveryRecord {
  const recordContent = content(body);
  return {
    eventId,
    provider: 'github',
    sourceId: 'github.example',
    kind: 'pull-request',
    id: recordId,
    revision,
    operation: revision === INITIAL_REVISION ? 'added' : 'updated',
    contentHash: digest(canonicalOpenConnectorContent(recordContent)!),
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
  } satisfies OpenConnectorDeliveryRecord;
}

function envelope({
  batchId,
  records,
}: {
  batchId: string;
  records: OpenConnectorDeliveryRecord[];
}): OpenConnectorDeliveryEnvelope {
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

async function tableCounts(database: SQL) {
  const [counts] = await database<
    Array<{ batches: number; events: number; records: number; jobs: number }>
  >`
    select
      (select count(*) from "open_connector_batch_receipt") as "batches",
      (select count(*) from "open_connector_record_event") as "events",
      (select count(*) from "open_connector_record") as "records",
      (select count(*) from "open_connector_ingestion_job") as "jobs"
  `;
  return counts!;
}

test('record acceptance is owner-bound, idempotent, monotonic, and atomically conflict-safe', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await insertOwner({ database, ownerId: OWNER_ID });
      await insertOwner({ database, ownerId: SECOND_OWNER_ID });
      const records = new OpenConnectorRecordsRepository(database);
      const service = new OpenConnectorRecordsService({
        records,
        ownerRegistration,
        now: () => RECEIVED_AT,
      });
      await expect(
        service.authenticateDeliveryApiKey({ deliveryApiKey: 'short-key' }),
      ).rejects.toThrow('Invalid open-connector delivery API key');

      const initial = activeRecord({ eventId: 'event-initial' });
      const firstEnvelope = envelope({ batchId: 'batch-initial', records: [initial] });
      expect(
        await service.accept({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          envelope: firstEnvelope,
          payloadHash: digest('batch-initial'),
        }),
      ).toEqual({ state: 'conflict', reason: 'integration_owner' });

      expect(
        await service.bindIntegration({ integrationId: 'missing-owner', ownerId: 'not-claimed' }),
      ).toEqual({ state: 'owner_not_found' });
      expect(
        await service.bindIntegration({ integrationId: INTEGRATION_ID, ownerId: OWNER_ID }),
      ).toEqual({ state: 'bound' });
      expect(
        await service.bindIntegration({ integrationId: INTEGRATION_ID, ownerId: OWNER_ID }),
      ).toEqual({ state: 'already_bound' });
      expect(
        await service.bindIntegration({ integrationId: INTEGRATION_ID, ownerId: SECOND_OWNER_ID }),
      ).toEqual({ state: 'owner_not_found' });

      const mismatched = activeRecord({
        eventId: 'event-content-hash-mismatch',
        recordId: 'content-hash-mismatch',
      });
      mismatched.contentHash = 'f'.repeat(SHA256_HEX_LENGTH);
      await expect(
        service.accept({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          envelope: envelope({
            batchId: 'batch-content-hash-mismatch',
            records: [initial, mismatched],
          }),
          payloadHash: digest('batch-content-hash-mismatch'),
        }),
      ).rejects.toThrow('contentHash must match the canonical record content');
      expect(await tableCounts(database)).toEqual({ batches: 0, events: 0, records: 0, jobs: 0 });

      expect(
        await service.accept({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          envelope: firstEnvelope,
          payloadHash: digest('batch-initial'),
        }),
      ).toEqual({ state: 'accepted' });
      expect(
        await service.accept({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          envelope: firstEnvelope,
          payloadHash: digest('batch-initial'),
        }),
      ).toEqual({ state: 'duplicate' });

      expect(
        await service.accept({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          envelope: envelope({ batchId: 'batch-repeated-event', records: [initial] }),
          payloadHash: digest('batch-repeated-event'),
        }),
      ).toEqual({ state: 'accepted' });
      expect(await tableCounts(database)).toEqual({ batches: 2, events: 1, records: 1, jobs: 1 });

      expect(
        await service.accept({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          envelope: envelope({
            batchId: 'batch-alias-event',
            records: [{ ...initial, eventId: 'event-material-alias' }],
          }),
          payloadHash: digest('batch-alias-event'),
        }),
      ).toEqual({ state: 'accepted' });
      expect(await tableCounts(database)).toEqual({ batches: 3, events: 2, records: 1, jobs: 1 });
      expect(
        (
          await service.find({
            integrationId: INTEGRATION_ID,
            ownerId: OWNER_ID,
            sourceId: initial.sourceId,
            kind: initial.kind,
            recordId: initial.id,
          })
        )?.content,
      ).toMatchObject({
        sourceCreatedAt: '2025-01-02T03:04:05-04:00',
        sourceUpdatedAt: '2026-08-09T10:11:12+05:30',
      });

      expect(
        await service.accept({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          envelope: envelope({
            batchId: 'batch-event-conflict',
            records: [
              activeRecord({ eventId: 'event-material-alias', body: 'changed event material' }),
            ],
          }),
          payloadHash: digest('batch-event-conflict'),
        }),
      ).toEqual({ state: 'conflict', reason: 'event' });

      const current = {
        ...activeRecord({
          eventId: 'event-current',
          revision: CURRENT_REVISION,
          body: 'newest searchable material',
        }),
        content: { body: 'newest searchable material' },
      };
      current.contentHash = digest(canonicalOpenConnectorContent(current.content)!);
      expect(
        await service.accept({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          envelope: envelope({ batchId: 'batch-current', records: [current] }),
          payloadHash: digest('batch-current'),
        }),
      ).toEqual({ state: 'accepted' });
      expect(
        await service.accept({
          integrationId: INTEGRATION_ID,
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
          payloadHash: digest('batch-stale'),
        }),
      ).toEqual({ state: 'accepted' });

      const stored = await service.find({
        integrationId: INTEGRATION_ID,
        ownerId: OWNER_ID,
        sourceId: current.sourceId,
        kind: current.kind,
        recordId: current.id,
      });
      expect(stored).toMatchObject({
        revision: CURRENT_REVISION,
        currentEventId: current.eventId,
        committedAt: current.committedAt,
      });
      expect(stored?.content).toEqual({ body: 'newest searchable material' });

      const beforeAtomicConflict = await tableCounts(database);
      expect(
        await service.accept({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          envelope: envelope({
            batchId: 'batch-atomic-conflict',
            records: [
              activeRecord({ eventId: 'event-must-rollback', recordId: 'must-rollback' }),
              activeRecord({
                eventId: 'event-revision-conflict',
                revision: CURRENT_REVISION,
                body: 'conflicting current revision',
              }),
            ],
          }),
          payloadHash: digest('batch-atomic-conflict'),
        }),
      ).toEqual({ state: 'conflict', reason: 'record_revision' });
      expect(await tableCounts(database)).toEqual(beforeAtomicConflict);

      expect(
        await service.accept({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          envelope: envelope({
            batchId: 'batch-delete',
            records: [deletedRecord({ eventId: 'event-delete', revision: DELETED_REVISION })],
          }),
          payloadHash: digest('batch-delete'),
        }),
      ).toEqual({ state: 'accepted' });
      expect(
        await service.find({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          sourceId: current.sourceId,
          kind: current.kind,
          recordId: current.id,
        }),
      ).toMatchObject({ revision: DELETED_REVISION, operation: 'deleted', content: null });
      expect(
        await service.accept({
          integrationId: INTEGRATION_ID,
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
          payloadHash: digest('batch-stale-after-delete'),
        }),
      ).toEqual({ state: 'accepted' });
      expect(
        await service.find({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          sourceId: current.sourceId,
          kind: current.kind,
          recordId: current.id,
        }),
      ).toMatchObject({ revision: DELETED_REVISION, operation: 'deleted', content: null });

      const secondIntegrationId = 'receiver-b';
      expect(
        await service.bindIntegration({ integrationId: secondIntegrationId, ownerId: OWNER_ID }),
      ).toEqual({ state: 'bound' });
      expect(
        await service.accept({
          integrationId: secondIntegrationId,
          ownerId: OWNER_ID,
          envelope: firstEnvelope,
          payloadHash: digest('batch-initial'),
        }),
      ).toEqual({ state: 'accepted' });
      expect(
        await service.find({
          integrationId: secondIntegrationId,
          ownerId: OWNER_ID,
          sourceId: initial.sourceId,
          kind: initial.kind,
          recordId: initial.id,
        }),
      ).toMatchObject({ ownerId: OWNER_ID, revision: INITIAL_REVISION });
      expect(
        await service.find({
          integrationId: INTEGRATION_ID,
          ownerId: SECOND_OWNER_ID,
          sourceId: initial.sourceId,
          kind: initial.kind,
          recordId: initial.id,
        }),
      ).toBeNull();
    },
  });
});

test('concurrent deliveries deduplicate batches and converge on the highest revision', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await insertOwner({ database, ownerId: OWNER_ID });
      const service = new OpenConnectorRecordsService({
        records: new OpenConnectorRecordsRepository(database),
        ownerRegistration,
        now: () => RECEIVED_AT,
      });
      await service.bindIntegration({ integrationId: INTEGRATION_ID, ownerId: OWNER_ID });

      const duplicateInput = {
        integrationId: INTEGRATION_ID,
        ownerId: OWNER_ID,
        envelope: envelope({
          batchId: 'batch-concurrent-duplicate',
          records: [activeRecord({ eventId: 'event-concurrent-duplicate' })],
        }),
        payloadHash: digest('batch-concurrent-duplicate'),
      } as const;
      const duplicateResults = await Promise.all([
        service.accept(duplicateInput),
        service.accept(duplicateInput),
      ]);
      expect(duplicateResults.map(({ state }) => state).sort()).toEqual(['accepted', 'duplicate']);

      const recordId = 'concurrent-revisions';
      const revisionResults = await Promise.all([
        service.accept({
          integrationId: INTEGRATION_ID,
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
          payloadHash: digest('batch-concurrent-low'),
        }),
        service.accept({
          integrationId: INTEGRATION_ID,
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
          payloadHash: digest('batch-concurrent-high'),
        }),
      ]);
      expect(revisionResults).toEqual([{ state: 'accepted' }, { state: 'accepted' }]);
      expect(
        await service.find({
          integrationId: INTEGRATION_ID,
          ownerId: OWNER_ID,
          sourceId: 'github.example',
          kind: 'pull-request',
          recordId,
        }),
      ).toMatchObject({ revision: STALE_REVISION, content: { body: 'concurrent high revision' } });

      const duplicateJobs = await database<Array<{ eventId: string; total: number }>>`
        select "event_id" as "eventId", count(*) as "total"
        from "open_connector_ingestion_job"
        group by "integration_id", "event_id"
        having count(*) > 1
      `;
      expect(duplicateJobs).toEqual([]);
    },
  });
});

test('a durable acceptance failure rolls back before a later retry succeeds', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await insertOwner({ database, ownerId: OWNER_ID });
      const service = new OpenConnectorRecordsService({
        records: new OpenConnectorRecordsRepository(database),
        ownerRegistration,
        now: () => RECEIVED_AT,
      });
      await service.bindIntegration({ integrationId: INTEGRATION_ID, ownerId: OWNER_ID });
      await database`
        create trigger "open_connector_test_reject_job"
        before insert on "open_connector_ingestion_job"
        begin
          select raise(abort, 'simulated durable acceptance failure');
        end
      `;

      const input = {
        integrationId: INTEGRATION_ID,
        ownerId: OWNER_ID,
        envelope: envelope({
          batchId: 'batch-durable-retry',
          records: [activeRecord({ eventId: 'event-durable-retry' })],
        }),
        payloadHash: digest('batch-durable-retry'),
      } as const;
      await expect(service.accept(input)).rejects.toThrow('simulated durable acceptance failure');
      expect(await tableCounts(database)).toEqual({ batches: 0, events: 0, records: 0, jobs: 0 });

      await database`drop trigger "open_connector_test_reject_job"`;
      expect(await service.accept(input)).toEqual({ state: 'accepted' });
      expect(await tableCounts(database)).toEqual({ batches: 1, events: 1, records: 1, jobs: 1 });
      expect(await service.accept(input)).toEqual({ state: 'duplicate' });
    },
  });
});

test('each delivery API key resolves one external service and cannot be assigned twice', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await insertOwner({ database, ownerId: OWNER_ID });
      const service = new OpenConnectorRecordsService({
        records: new OpenConnectorRecordsRepository(database),
        ownerRegistration,
        now: () => RECEIVED_AT,
      });
      expect(
        await service.bindIntegration({
          integrationId: 'github-sync',
          ownerId: OWNER_ID,
          name: 'Engineering GitHub',
        }),
      ).toEqual({ state: 'bound' });
      expect(
        await service.bindIntegration({
          integrationId: 'linear-sync',
          ownerId: OWNER_ID,
          name: 'Product Linear',
        }),
      ).toEqual({ state: 'bound' });

      await service.recordDeliveryApiKeyRegistration({
        integrationId: 'github-sync',
        ownerId: OWNER_ID,
        deliveryApiKey: SHARED_DELIVERY_API_KEY,
      });
      expect(
        await service.authenticateDeliveryApiKey({ deliveryApiKey: SHARED_DELIVERY_API_KEY }),
      ).toEqual({
        integrationId: 'github-sync',
        ownerId: OWNER_ID,
        name: 'Engineering GitHub',
      });

      await expect(
        service.recordDeliveryApiKeyRegistration({
          integrationId: 'linear-sync',
          ownerId: OWNER_ID,
          deliveryApiKey: SHARED_DELIVERY_API_KEY,
        }),
      ).rejects.toThrow('delivery API key already identifies another integration');
      expect(
        await service.authenticateDeliveryApiKey({ deliveryApiKey: SHARED_DELIVERY_API_KEY }),
      ).toEqual({
        integrationId: 'github-sync',
        ownerId: OWNER_ID,
        name: 'Engineering GitHub',
      });
    },
  });
});
