import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import type { Storage } from '#lib/storage/storage.ts';
import type { RecordContent } from '#models/records/delivery-contract.generated.ts';
import type { RecordListFilters } from '#models/records/model.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { RecordsService } from '#services/records/service.ts';
import { withRecordTestDatabase } from './database.ts';

const OWNER_ID = OWNER_USER_ID;
const SECOND_OWNER_ID = 'owner-b';
const SYNC_ID = '01991f43-0c00-7000-8000-000000000001';
const SECOND_SYNC_ID = '01991f43-0c00-7000-8000-000000000002';
const RECEIVED_AT = new Date('2026-09-08T08:00:00.000Z');
const UUID_SUFFIX_LENGTH = 12;

function digest(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function record({
  id,
  provider,
  kind,
  created,
  updated,
}: {
  id: string;
  provider: string;
  kind: string;
  created?: string;
  updated?: string;
}) {
  const content: RecordContent = { title: `Title of ${id}`, body: `Body of ${id}` };
  if (created) {
    content.sourceCreatedAt = created;
  }
  if (updated) {
    content.sourceUpdatedAt = updated;
  }
  return {
    eventId: `00000000-0000-4000-8000-${digest(id).slice(-UUID_SUFFIX_LENGTH)}`,
    sourceId: 'github.example',
    id,
    revision: 1,
    operation: 'added' as const,
    committedAt: RECEIVED_AT.toISOString(),
    provider,
    kind,
    content,
    contentHash: digest(JSON.stringify(content)),
  };
}

async function withRecords(
  run: (context: {
    repository: RecordsRepository;
    service: RecordsService;
    database: SQL;
    storage: Storage;
  }) => Promise<void>,
) {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      for (const [ownerId, syncId, readableId] of [
        [OWNER_ID, SYNC_ID, 'owner-sync'],
        [SECOND_OWNER_ID, SECOND_SYNC_ID, 'other-sync'],
      ] as const) {
        await database`
          insert into "auth_user"
            ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
          values (${ownerId}, ${ownerId}, ${`${ownerId}@example.invalid`}, 1,
            ${RECEIVED_AT.toISOString()}, ${RECEIVED_AT.toISOString()})
        `;
        await database`
          insert into "record_sync"
            ("id", "owner_id", "readable_id", "name", "api_key_sha256", "created_at")
          values (${syncId}, ${ownerId}, ${readableId}, ${readableId}, ${digest(`${syncId}-key`)},
            ${RECEIVED_AT.toISOString()})
        `;
      }
      const storage = createLocalStorage({ dataFolder });
      const repository = new RecordsRepository(database);
      const service = new RecordsService({ records: repository, storage, now: () => RECEIVED_AT });
      await service.accept({
        ownerId: OWNER_ID,
        syncId: SYNC_ID,
        envelope: {
          version: 1,
          batchId: 'browse',
          records: [
            record({
              id: 'a',
              provider: 'github',
              kind: 'issue',
              created: '2026-01-02T00:00:00Z',
              updated: '2026-01-03T00:00:00Z',
            }),
            record({
              id: 'b',
              provider: 'slack',
              kind: 'message',
              created: '2026-01-02T04:00:00+05:00',
              updated: '2026-01-02T00:00:00Z',
            }),
            record({
              id: 'c',
              provider: 'github',
              kind: 'pull-request',
              created: '2026-01-03T00:00:00Z',
              updated: '2026-01-01T00:00:00Z',
            }),
            record({ id: 'missing', provider: 'granola', kind: 'meeting' }),
          ],
        },
      });
      await service.accept({
        ownerId: SECOND_OWNER_ID,
        syncId: SECOND_SYNC_ID,
        envelope: {
          version: 1,
          batchId: 'other',
          records: [record({ id: 'private', provider: 'private-provider', kind: 'private-kind' })],
        },
      });
      await run({ repository, service, database, storage });
    },
  });
}

test('orders source dates, provider and kind before pagination, with missing dates last in either direction', async () => {
  await withRecords(async ({ repository }) => {
    const cases: [RecordListFilters, string[]][] = [
      [{ sortBy: 'sourceCreatedAt', sortDirection: 'asc' }, ['b', 'a', 'c', 'missing']],
      [{ sortBy: 'sourceCreatedAt', sortDirection: 'desc' }, ['c', 'a', 'b', 'missing']],
      [{ sortBy: 'sourceUpdatedAt', sortDirection: 'asc' }, ['c', 'b', 'a', 'missing']],
      [{ sortBy: 'sourceUpdatedAt', sortDirection: 'desc' }, ['a', 'b', 'c', 'missing']],
      [{ sortBy: 'provider', sortDirection: 'asc' }, ['a', 'c', 'missing', 'b']],
      [{ sortBy: 'provider', sortDirection: 'desc' }, ['b', 'missing', 'a', 'c']],
      [{ sortBy: 'kind', sortDirection: 'asc' }, ['a', 'missing', 'b', 'c']],
      [{ sortBy: 'kind', sortDirection: 'desc' }, ['c', 'b', 'missing', 'a']],
    ];
    for (const [filters, ids] of cases) {
      const first = await repository.listResources({
        ownerId: OWNER_ID,
        limit: 2,
        offset: 0,
        ...filters,
      });
      const second = await repository.listResources({
        ownerId: OWNER_ID,
        limit: 2,
        offset: first.nextOffset!,
        ...filters,
      });
      expect([...first.items, ...second.items].map((item) => item.recordId)).toEqual(ids);
      expect(second.nextOffset).toBeNull();
    }
  });
});

test('combines exact metadata and source date bounds across the collection without reading unrelated files', async () => {
  await withRecords(async ({ repository, database, storage }) => {
    // An unavailable nonmatching record must not be read to filter the collection.
    const [slack] = await database<
      { storageKey: string }[]
    >`select "storage_key" as "storageKey" from "record" where "provider" = 'slack'`;
    await storage.delete(slack!.storageKey);
    const page = await repository.listResources({
      ownerId: OWNER_ID,
      limit: 1,
      offset: 0,
      provider: 'github',
      kind: 'pull-request',
      createdFrom: '2026-01-02T19:00:00-05:00',
      createdTo: '2026-01-04T00:00:00Z',
      updatedFrom: '2026-01-01T00:00:00Z',
      updatedTo: '2026-01-02T00:00:00Z',
    });
    expect(page.items).toMatchObject([
      {
        recordId: 'c',
        title: 'Title of c',
        provider: 'github',
        sourceCreatedAt: '2026-01-03T00:00:00Z',
      },
    ]);
    expect(page.nextOffset).toBeNull();
    expect(page.filterOptions).toEqual({
      providers: ['github', 'granola', 'slack'],
      kinds: ['issue', 'meeting', 'message', 'pull-request'],
    });
    const excluded = await repository.listResources({
      ownerId: OWNER_ID,
      limit: 5,
      offset: 0,
      provider: 'github',
      createdTo: '2026-01-02T00:00:00Z',
    });
    expect(excluded.items).toEqual([]);
    const missing = await repository.listResources({
      ownerId: OWNER_ID,
      limit: 5,
      offset: 0,
      provider: 'granola',
    });
    expect(missing.items).toMatchObject([{ sourceCreatedAt: null, sourceUpdatedAt: null }]);
    expect(
      (
        await repository.listResources({
          ownerId: OWNER_ID,
          limit: 5,
          offset: 0,
          provider: 'granola',
          updatedFrom: '2020-01-01T00:00:00Z',
        })
      ).items,
    ).toEqual([]);
  });
});

test('publishes title and browse corrections atomically, ignoring stale revisions and removing tombstones from facets', async () => {
  await withRecords(async ({ repository, service, database }) => {
    const original = record({
      id: 'a',
      provider: 'github',
      kind: 'issue',
      created: '2026-01-02T00:00:00Z',
      updated: '2026-01-03T00:00:00Z',
    });
    const changed = {
      ...original,
      revision: 2,
      operation: 'updated' as const,
      content: {
        ...original.content,
        title: 'Corrected title',
        sourceUpdatedAt: '2026-02-01T00:00:00Z',
      },
    };
    const accept = (records: Parameters<RecordsService['accept']>[0]['envelope']['records']) =>
      service.accept({
        ownerId: OWNER_ID,
        syncId: SYNC_ID,
        envelope: { version: 1, batchId: 'update', records },
      });
    const before = await repository.listResources({ ownerId: OWNER_ID, limit: 10, offset: 0 });
    const conflict = {
      ...record({ id: 'b', provider: 'slack', kind: 'message' }),
      content: { title: 'Conflicting revision', body: 'conflict' },
    };
    expect(await accept([changed, conflict])).toEqual({ state: 'conflict' });
    expect(await repository.listResources({ ownerId: OWNER_ID, limit: 10, offset: 0 })).toEqual(
      before,
    );
    expect(await accept([changed, original])).toEqual({ state: 'accepted' });
    const after = await repository.listResources({ ownerId: OWNER_ID, limit: 1, offset: 0 });
    expect(after.items[0]).toMatchObject({
      readableId: before.items[0]!.readableId,
      title: 'Corrected title',
      updatedAt: RECEIVED_AT.toISOString(),
    });
    expect(
      (await service.findResource({ ownerId: OWNER_ID, readableId: after.items[0]!.readableId }))
        ?.record.content.title,
    ).toBe('Corrected title');
    const { content: _content, ...slack } = record({ id: 'b', provider: 'slack', kind: 'message' });
    expect(await accept([{ ...slack, revision: 3, operation: 'deleted' }])).toEqual({
      state: 'accepted',
    });
    expect(
      (await repository.listResources({ ownerId: OWNER_ID, limit: 10, offset: 0 })).filterOptions
        .providers,
    ).toEqual(['github', 'granola']);
    const rows =
      await database`select "provider" from "record" where "owner_id" = ${OWNER_ID} and "provider" = 'slack' and "operation" <> 'deleted'`;
    expect(rows).toHaveLength(0);
  });
});
