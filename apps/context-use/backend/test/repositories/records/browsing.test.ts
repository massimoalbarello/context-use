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
  occurred,
}: {
  id: string;
  provider: string;
  kind: string;
  created?: string;
  updated?: string;
  occurred?: string;
}) {
  return {
    source: { provider, kind, id },
    title: `Title of ${id}`,
    body: `Body of ${id}`,
    sourceCreatedAt: created,
    sourceUpdatedAt: updated,
    sourceOccurredAt: occurred,
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

test('orders by source occurrence, update or creation before pagination, with missing dates last', async () => {
  await withRecords(async ({ repository, service, database }) => {
    for (const [id, created] of [
      ['newest-created', '2026-01-04T00:00:00Z'],
      ['middle-created', '2026-01-01T12:00:00Z'],
    ] as const) {
      await service.upsert({
        change: { clientName: null, message: 'Save playlist item' },
        ownerId: OWNER_ID,
        record: record({ id, provider: 'youtube', kind: 'playlist-item', created }),
      });
    }
    for (const input of [
      record({
        id: 'newest-occurred',
        provider: 'googlecalendar',
        kind: 'event',
        occurred: '2026-01-04T21:00:00-05:00',
        created: '2025-01-01T00:00:00Z',
        updated: '2025-01-02T00:00:00Z',
      }),
      record({
        id: 'older-occurred',
        provider: 'granola',
        kind: 'meeting',
        occurred: '2025-12-31',
        created: '2027-01-01T00:00:00Z',
        updated: '2027-01-02T00:00:00Z',
      }),
    ]) {
      await service.upsert({
        change: { clientName: null, message: 'Save occurrence time' },
        ownerId: OWNER_ID,
        record: input,
      });
    }
    // Local receipt time must not promote an older or undated source record.
    await database`update "record" set "updated_at" = '2026-09-09T00:00:00.000Z'
      where "owner_id" = ${OWNER_ID} and "source_id" in ('c', 'missing')`;
    const first = await repository.listResources({ ownerId: OWNER_ID, limit: 2, offset: 0 });
    expect(first.items.map((item) => item.source.id)).toEqual([
      'newest-occurred',
      'newest-created',
    ]);
    expect(first.items[0]).toMatchObject({
      sourceOccurredAt: '2026-01-05T02:00:00.000Z',
    });
    expect(first.items[1]).toMatchObject({
      sourceCreatedAt: '2026-01-04T00:00:00.000Z',
      sourceUpdatedAt: null,
      sourceOccurredAt: null,
    });
    expect(first.nextOffset).toBe(2);
    const second = await repository.listResources({
      ownerId: OWNER_ID,
      limit: 2,
      offset: first.nextOffset!,
    });
    expect(second.items.map((item) => item.source.id)).toEqual(['a', 'b']);
    expect(second.nextOffset).toBe(first.items.length + second.items.length);
    const third = await repository.listResources({
      ownerId: OWNER_ID,
      limit: 2,
      offset: second.nextOffset!,
    });
    expect(third.items.map((item) => item.source.id)).toEqual(['middle-created', 'c']);
    const fourth = await repository.listResources({
      ownerId: OWNER_ID,
      limit: 2,
      offset: third.nextOffset!,
    });
    expect(fourth.items.map((item) => item.source.id)).toEqual(['older-occurred', 'missing']);
    expect(fourth.items[0]).toMatchObject({ sourceOccurredAt: '2025-12-31' });
    expect(fourth.nextOffset).toBeNull();
  });
});

test('source occurrence, update and creation ties remain stable across page boundaries', async () => {
  await withRecords(async ({ repository, service }) => {
    await service.upsert({
      change: { clientName: null, message: 'Save playlist item' },
      ownerId: OWNER_ID,
      record: record({
        id: 'created-tie',
        provider: 'youtube',
        kind: 'playlist-item',
        created: '2026-01-02T19:00:00-05:00',
      }),
    });
    await service.upsert({
      change: { clientName: null, message: 'Save calendar event' },
      ownerId: OWNER_ID,
      record: record({
        id: 'occurred-tie',
        provider: 'googlecalendar',
        kind: 'event',
        occurred: '2026-01-03',
        updated: '2027-01-01T00:00:00Z',
      }),
    });
    const list = (offset: number) =>
      repository.listResources({ ownerId: OWNER_ID, limit: 1, offset });
    const first = await list(0);
    expect(first.nextOffset).toBe(1);
    const second = await list(first.nextOffset!);
    const third = await list(second.nextOffset!);
    const tied = [...first.items, ...second.items, ...third.items];
    expect(tied.map((item) => item.source.id).sort()).toEqual(['a', 'created-tie', 'occurred-tie']);
    expect(tied.map((item) => item.readableId)).toEqual(tied.map((item) => item.readableId).sort());
    expect(await list(0)).toEqual(first);
    expect(await list(1)).toEqual(second);
    expect(await list(2)).toEqual(third);
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
