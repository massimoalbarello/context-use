import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import type { Storage } from '#backend/lib/storage/storage.ts';
import type { RecordInput, RecordListFilters } from '#backend/models/records/model.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { createTestHypermediaRetrievalService } from '../../support/hypermedia-retrieval.ts';
import { withRecordTestDatabase } from './database.ts';

const OWNER_ID = OWNER_USER_ID;
const SECOND_OWNER_ID = 'owner-b';
const RECEIVED_AT = new Date('2026-09-08T08:00:00.000Z');
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
  return {
    source: { provider, kind, id },
    title: `Title of ${id}`,
    body: `Body of ${id}`,
    sourceCreatedAt: created,
    sourceUpdatedAt: updated,
  } satisfies RecordInput;
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
      for (const ownerId of [OWNER_ID, SECOND_OWNER_ID]) {
        await database`
          insert into "auth_user"
            ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
          values (${ownerId}, ${ownerId}, ${`${ownerId}@example.invalid`}, 1,
            ${RECEIVED_AT.toISOString()}, ${RECEIVED_AT.toISOString()})
        `;
      }
      const storage = createLocalStorage({ dataFolder });
      const repository = new RecordsRepository(database);
      const service = new RecordsService({
        records: repository,
        storage,
        now: () => RECEIVED_AT,
      });
      for (const input of [
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
      ]) {
        await service.upsert({
          change: { clientName: null, message: 'Updated test context' },
          ownerId: OWNER_ID,
          record: input,
        });
      }
      await service.upsert({
        change: { clientName: null, message: 'Updated test context' },
        ownerId: SECOND_OWNER_ID,
        record: record({ id: 'private', provider: 'private-provider', kind: 'private-kind' }),
      });
      await run({ repository, service, database, storage });
    },
  });
}

test('orders source dates before pagination, with missing dates last in either direction', async () => {
  await withRecords(async ({ repository }) => {
    const cases: [RecordListFilters, string[]][] = [
      [{ sortBy: 'sourceCreatedAt', sortDirection: 'asc' }, ['b', 'a', 'c', 'missing']],
      [{ sortBy: 'sourceCreatedAt', sortDirection: 'desc' }, ['c', 'a', 'b', 'missing']],
      [{ sortBy: 'sourceUpdatedAt', sortDirection: 'asc' }, ['c', 'b', 'a', 'missing']],
      [{ sortBy: 'sourceUpdatedAt', sortDirection: 'desc' }, ['a', 'b', 'c', 'missing']],
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
      expect([...first.items, ...second.items].map((item) => item.source.id)).toEqual(ids);
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
        source: { id: 'c', provider: 'github' },
        title: 'Title of c',
        sourceCreatedAt: '2026-01-03T00:00:00.000Z',
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

test('record keyword retrieval applies source date bounds before top K', async () => {
  await withRecords(async ({ database, storage }) => {
    const retrieval = createTestHypermediaRetrievalService({ database, storage });
    const search = (filters: RecordListFilters) =>
      retrieval.search({
        ownerId: OWNER_ID,
        query: 'Title',
        resourceTypes: ['record'],
        limit: 1,
        filters: { record: filters },
      });
    const cases: [RecordListFilters, string][] = [
      [{ createdFrom: '2026-01-03T00:00:00Z' }, 'c'],
      [{ createdTo: '2026-01-02T00:00:00Z' }, 'b'],
      [{ updatedFrom: '2026-01-03T00:00:00Z' }, 'a'],
      [{ updatedTo: '2026-01-02T00:00:00Z' }, 'c'],
      [{ provider: 'slack' }, 'b'],
      [{ kind: 'meeting' }, 'missing'],
      [
        {
          provider: 'github',
          kind: 'pull-request',
          createdFrom: '2026-01-02T19:00:00-05:00',
          createdTo: '2026-01-04T00:00:00Z',
          updatedFrom: '2026-01-01T00:00:00Z',
          updatedTo: '2026-01-02T00:00:00Z',
        },
        'c',
      ],
    ];
    for (const [filters, id] of cases) {
      const result = await search(filters);
      expect(result.results).toMatchObject([
        { resourceType: 'record', record: { source: { id } } },
      ]);
      expect(result.totalMatches).toBe(1);
      expect(result.truncated).toBe(false);
    }
    expect(
      (await search({ provider: 'granola', createdFrom: '2020-01-01T00:00:00Z' })).results,
    ).toEqual([]);
  });
});
