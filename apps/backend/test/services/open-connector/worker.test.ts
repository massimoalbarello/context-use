import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import type {
  OpenConnectorDeliveryEnvelope,
  OpenConnectorDeliveryRecord,
} from '#models/open-connector/model.ts';
import { OpenConnectorRecordsRepository } from '#repositories/open-connector/repository.ts';
import { OpenConnectorRecordsService } from '#services/open-connector/service.ts';
import { OpenConnectorIngestionWorker } from '#services/open-connector/worker.ts';

const OWNER_ID = OWNER_USER_ID;
const INTEGRATION_ID = 'worker-receiver';
const FIRST_REVISION = 1;
const SECOND_REVISION = 2;
const THIRD_REVISION = 3;
const SECOND = 1_000;
const LEASE_SECONDS = 30;
const LEASE_MILLISECONDS = LEASE_SECONDS * SECOND;
const LONG_POLL_MILLISECONDS = 60 * SECOND;

const ownerRegistration = {
  state: async () => ({ ownerExists: true, passkeyExists: true }),
};

function digest(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function record({
  eventId,
  recordId,
  revision,
  body,
}: {
  eventId: string;
  recordId: string;
  revision: number;
  body: string;
}): OpenConnectorDeliveryRecord {
  return {
    eventId,
    provider: 'github',
    sourceId: 'github.example',
    kind: 'pull-request',
    id: recordId,
    revision,
    operation: revision === FIRST_REVISION ? 'added' : 'updated',
    contentHash: digest(body),
    committedAt: `2026-09-08T08:00:0${revision}.000Z`,
    content: { body },
  };
}

function deletion({ eventId, recordId }: { eventId: string; recordId: string }) {
  return {
    eventId,
    provider: 'github',
    sourceId: 'github.example',
    kind: 'pull-request',
    id: recordId,
    revision: THIRD_REVISION,
    operation: 'deleted',
    contentHash: digest('deleted'),
    committedAt: '2026-09-08T08:00:03.000Z',
  } satisfies OpenConnectorDeliveryRecord;
}

async function insertOwner({
  database,
  timestamp,
}: {
  database: SQL;
  timestamp: string;
}): Promise<void> {
  await database`
    insert into "auth_user"
      ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values (${OWNER_ID}, 'Worker owner', 'worker@example.invalid', 1, ${timestamp}, ${timestamp})
  `;
}

test('leased ingestion survives restart and fences stale updates and deletions', async () => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-open-connector-worker-'));
  let database = await createSqliteDatabase({ dataFolder });
  let nowMilliseconds = Date.parse('2026-09-08T08:00:00.000Z');
  const now = () => new Date(nowMilliseconds);
  let tokenNumber = 0;
  const leaseToken = () => `lease-${++tokenNumber}`;

  try {
    await runMigrations({ db: database });
    await insertOwner({ database, timestamp: now().toISOString() });
    let repository = new OpenConnectorRecordsRepository(database);
    let service = new OpenConnectorRecordsService({ records: repository, ownerRegistration, now });
    expect(
      await service.bindIntegration({ integrationId: INTEGRATION_ID, ownerId: OWNER_ID }),
    ).toEqual({ state: 'bound' });
    expect(await repository.hasUnfinishedJobs()).toBe(false);
    let worker = new OpenConnectorIngestionWorker({
      records: repository,
      now,
      leaseToken,
      leaseMilliseconds: LEASE_MILLISECONDS,
      pollMilliseconds: LONG_POLL_MILLISECONDS,
    });
    const accept = async ({
      batchId,
      records,
    }: {
      batchId: string;
      records: OpenConnectorDeliveryRecord[];
    }) => {
      const envelope: OpenConnectorDeliveryEnvelope = { version: 1, batchId, records };
      return await service.accept({
        integrationId: INTEGRATION_ID,
        ownerId: OWNER_ID,
        envelope,
        payloadHash: digest(batchId),
      });
    };

    await accept({
      batchId: 'batch-visible-first',
      records: [
        record({
          eventId: 'event-visible-first',
          recordId: 'visible-record',
          revision: FIRST_REVISION,
          body: 'legacytoken initial body',
        }),
      ],
    });
    expect(await repository.hasUnfinishedJobs()).toBe(true);
    expect(await worker.tick()).toBe('completed');
    expect(await repository.hasUnfinishedJobs()).toBe(false);
    expect(
      await service.search({
        ownerId: OWNER_ID,
        query: 'legacytoken',
        limit: 10,
      }),
    ).toHaveLength(1);

    nowMilliseconds += SECOND;
    await accept({
      batchId: 'batch-visible-second',
      records: [
        record({
          eventId: 'event-visible-second',
          recordId: 'visible-record',
          revision: SECOND_REVISION,
          body: 'currenttoken replacement body',
        }),
      ],
    });
    expect(
      await service.search({
        ownerId: OWNER_ID,
        query: 'legacytoken',
        limit: 10,
      }),
    ).toEqual([]);
    expect(await worker.tick()).toBe('completed');
    expect(
      await service.search({
        ownerId: OWNER_ID,
        query: 'currenttoken',
        limit: 10,
      }),
    ).toMatchObject([{ recordId: 'visible-record', revision: SECOND_REVISION }]);

    nowMilliseconds += SECOND;
    await accept({
      batchId: 'batch-delayed-first',
      records: [
        record({
          eventId: 'event-delayed-first',
          recordId: 'delayed-record',
          revision: FIRST_REVISION,
          body: 'staletoken delayed body',
        }),
      ],
    });
    const delayed = await repository.claimJob({
      now: now().toISOString(),
      leaseToken: 'delayed-lease',
      leaseExpiresAt: new Date(nowMilliseconds + LEASE_MILLISECONDS).toISOString(),
    });
    expect(delayed).not.toBeNull();
    if (!delayed) {
      throw new Error('Expected a delayed ingestion job');
    }

    nowMilliseconds += SECOND;
    await accept({
      batchId: 'batch-delayed-second',
      records: [
        record({
          eventId: 'event-delayed-second',
          recordId: 'delayed-record',
          revision: SECOND_REVISION,
          body: 'freshdelayedtoken replacement body',
        }),
      ],
    });
    expect(await worker.tick()).toBe('completed');
    expect(
      await service.search({
        ownerId: OWNER_ID,
        query: 'freshdelayedtoken',
        limit: 10,
      }),
    ).toHaveLength(1);

    nowMilliseconds += SECOND;
    await accept({
      batchId: 'batch-delete',
      records: [deletion({ eventId: 'event-delete', recordId: 'delayed-record' })],
    });
    expect(
      await service.search({
        ownerId: OWNER_ID,
        query: 'freshdelayedtoken',
        limit: 10,
      }),
    ).toEqual([]);
    expect(await worker.tick()).toBe('completed');
    expect(
      await repository.completeJob({
        job: delayed,
        projection: { label: 'stale projection', body: 'staletoken delayed body' },
        completedAt: now().toISOString(),
      }),
    ).toBe('superseded');
    expect(
      await service.search({
        ownerId: OWNER_ID,
        query: 'staletoken',
        limit: 10,
      }),
    ).toEqual([]);
    const [documents] = await database<Array<{ total: number }>>`
      select count(*) as "total"
      from "open_connector_search_document"
      where "record_id" = 'delayed-record'
    `;
    expect(documents?.total).toBe(0);

    nowMilliseconds += SECOND;
    await accept({
      batchId: 'batch-restart',
      records: [
        record({
          eventId: 'event-restart',
          recordId: 'restart-record',
          revision: FIRST_REVISION,
          body: 'restarttoken durable body',
        }),
      ],
    });
    const restartLease = await repository.claimJob({
      now: now().toISOString(),
      leaseToken: 'restart-lease',
      leaseExpiresAt: new Date(nowMilliseconds + SECOND).toISOString(),
    });
    expect(restartLease?.recordId).toBe('restart-record');

    await database.close();
    nowMilliseconds += 2 * SECOND;
    database = await createSqliteDatabase({ dataFolder });
    await runMigrations({ db: database });
    repository = new OpenConnectorRecordsRepository(database);
    service = new OpenConnectorRecordsService({ records: repository, ownerRegistration, now });
    worker = new OpenConnectorIngestionWorker({
      records: repository,
      now,
      leaseToken,
      leaseMilliseconds: LEASE_MILLISECONDS,
      pollMilliseconds: LONG_POLL_MILLISECONDS,
    });
    expect(
      await service.accept({
        integrationId: INTEGRATION_ID,
        ownerId: OWNER_ID,
        envelope: {
          version: 1,
          batchId: 'batch-restart',
          records: [
            record({
              eventId: 'event-restart',
              recordId: 'restart-record',
              revision: FIRST_REVISION,
              body: 'restarttoken durable body',
            }),
          ],
        },
        payloadHash: digest('batch-restart'),
      }),
    ).toEqual({ state: 'duplicate' });
    expect(
      await service.accept({
        integrationId: INTEGRATION_ID,
        ownerId: OWNER_ID,
        envelope: {
          version: 1,
          batchId: 'batch-restart-repeated-event',
          records: [
            record({
              eventId: 'event-restart',
              recordId: 'restart-record',
              revision: FIRST_REVISION,
              body: 'restarttoken durable body',
            }),
          ],
        },
        payloadHash: digest('batch-restart-repeated-event'),
      }),
    ).toEqual({ state: 'accepted' });
    expect(await worker.tick()).toBe('completed');
    expect(
      await service.search({
        ownerId: OWNER_ID,
        query: 'restarttoken',
        limit: 10,
      }),
    ).toMatchObject([{ recordId: 'restart-record', revision: FIRST_REVISION }]);

    worker.start();
    await worker.stop();

    nowMilliseconds += SECOND;
    await accept({
      batchId: 'batch-recovery-only',
      records: [
        record({
          eventId: 'event-recovery-only',
          recordId: 'recovery-only-record',
          revision: FIRST_REVISION,
          body: 'recoveryonlytoken durable body',
        }),
      ],
    });
    const recoveryLease = await repository.claimJob({
      now: now().toISOString(),
      leaseToken: 'recovery-delayed-lease',
      leaseExpiresAt: new Date(nowMilliseconds + 2 * SECOND).toISOString(),
    });
    expect(recoveryLease?.recordId).toBe('recovery-only-record');
    expect(await repository.hasUnfinishedJobs()).toBe(true);

    const advancingNow = () => {
      const current = new Date(nowMilliseconds);
      nowMilliseconds += SECOND;
      return current;
    };
    const recoveryWorker = new OpenConnectorIngestionWorker({
      records: repository,
      now: advancingNow,
      leaseToken,
      leaseMilliseconds: LEASE_MILLISECONDS,
      pollMilliseconds: 1,
      stopWhenDrained: true,
    });
    recoveryWorker.start();
    await recoveryWorker.waitUntilStopped();

    expect(await repository.hasUnfinishedJobs()).toBe(false);
    expect(
      await service.search({
        ownerId: OWNER_ID,
        query: 'recoveryonlytoken',
        limit: 10,
      }),
    ).toMatchObject([{ recordId: 'recovery-only-record', revision: FIRST_REVISION }]);
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});
