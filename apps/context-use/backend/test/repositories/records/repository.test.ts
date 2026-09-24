import { expect, spyOn, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import type { RecordInput } from '#backend/models/records/model.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { createTestHypermediaRetrievalService } from '../../support/hypermedia-retrieval.ts';
import { withRecordTestDatabase } from './database.ts';

const DISTINCT_RECORD_COUNT = 4;
const NOW = '2026-09-08T08:00:00.000Z';
const NEXT = '2026-09-09T08:00:00.000Z';
const LAST = '2026-09-10T08:00:00.000Z';
function record(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    source: { provider: 'github', kind: 'pull-request', id: 'PR_1' },
    title: 'Original title',
    body: 'Originalneedle',
    sourceUpdatedAt: NOW,
    ...overrides,
  };
}
async function withRecords(
  run: (context: {
    service: RecordsService;
    database: Parameters<typeof createTestHypermediaRetrievalService>[0]['database'];
    dataFolder: string;
    storage: LocalStorage;
  }) => Promise<void>,
) {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      for (const owner of ['owner-a', 'owner-b']) {
        await database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${owner}, ${owner}, ${`${owner}@example.invalid`}, 1, ${NOW}, ${NOW})`;
      }
      const storage = new LocalStorage(join(dataFolder, 'objects'));
      const service = new RecordsService({
        records: new RecordsRepository(database),
        storage,
        now: () => new Date(NOW),
      });
      await run({ service, database, dataFolder, storage });
    },
  });
}

test.each([
  { name: 'Unicode Markdown with original whitespace', body: '# Notes\r\n\r\nCafé **📚**\r\n\r\n' },
  { name: 'an empty body', body: '' },
])('stores $name in a Markdown file and metadata in SQLite', async ({ body }) => {
  await withRecords(async ({ service, database, dataFolder, storage }) => {
    const input = record({
      body,
      source: {
        provider: 'github',
        kind: 'pull-request',
        id: 'PR_1',
        url: 'https://example.com/pr/1',
      },
      sourceCreatedAt: NOW,
    });
    const result = await service.upsert({
      change: { clientName: null, message: 'Added source context' },
      ownerId: 'owner-a',
      record: input,
    });
    expect(result.state).toBe('created');
    const [stored] = await database<
      {
        storage_key: string;
        content_hash: string;
        size_bytes: number;
        title: string;
        source_url: string;
        source_created_at: string;
        source_updated_at: string;
      }[]
    >`select * from "record" where "owner_id" = 'owner-a'`;
    expect(stored).toMatchObject({
      title: input.title,
      source_url: input.source.url,
      source_created_at: NOW,
      source_updated_at: NOW,
      content_hash: new Bun.CryptoHasher('sha256').update(body).digest('hex'),
      size_bytes: Buffer.byteLength(body, 'utf8'),
    });
    expect(stored!.storage_key).toMatch(/^owner-a\/records\/[^/]+\/[^/]+\.md$/);
    expect(await readFile(join(dataFolder, 'objects', stored!.storage_key), 'utf8')).toBe(body);
    expect(
      await service.findResource({ ownerId: 'owner-a', readableId: result.readableId }),
    ).toMatchObject(input);
    const columns = await database<{ name: string }[]>`pragma table_info('record')`;
    expect(columns.map((column) => column.name)).not.toContain('body');
    const retrieval = createTestHypermediaRetrievalService({ database, storage });
    expect(
      (await retrieval.search({ ownerId: 'owner-a', query: input.title, limit: 5 })).results,
    ).toMatchObject([{ record: { readableId: result.readableId, title: input.title } }]);
  });
});

test.each([
  { title: 'Revised title' },
  {
    source: {
      provider: 'github',
      kind: 'pull-request',
      id: 'PR_1',
      url: 'https://example.com/pr/1',
    },
  },
  { sourceCreatedAt: NOW },
])('metadata-only changes require a newer version: %j', async (metadata) => {
  await withRecords(async ({ service }) => {
    const write = (value: RecordInput) =>
      service.upsert({
        change: { clientName: null, message: 'Updated source metadata' },
        ownerId: 'owner-a',
        record: value,
      });
    const original = record();
    const first = await write(original);
    expect((await write(record(metadata))).state).toBe('conflict');
    const updated = record({ ...metadata, sourceUpdatedAt: NEXT });
    expect((await write(updated)).state).toBe('updated');
    expect(
      await service.findResource({ ownerId: 'owner-a', readableId: first.readableId }),
    ).toMatchObject(updated);
    expect((await write(updated)).state).toBe('unchanged');
    expect((await write(original)).state).toBe('stale');
  });
});

test('sync revisions preserve metadata-only changes and fence stale replays with identical Markdown', async () => {
  await withRecords(async ({ service }) => {
    const latestRevision = 3;
    const write = ({ value, revision }: { value: RecordInput; revision: number }) =>
      service.upsert({
        change: { clientName: null, message: 'Synced source metadata' },
        ownerId: 'owner-a',
        record: value,
        sync: { syncId: 'metadata-sync', revision },
      });
    const original = record();
    const first = await write({ value: original, revision: 1 });
    const updated = record({ title: 'Synced revised title' });
    expect((await write({ value: updated, revision: 1 })).state).toBe('conflict');
    expect((await write({ value: updated, revision: 2 })).state).toBe('updated');
    expect((await write({ value: updated, revision: latestRevision })).state).toBe('unchanged');
    expect((await write({ value: original, revision: 2 })).state).toBe('stale');
    expect((await write({ value: original, revision: latestRevision })).state).toBe('conflict');
    expect(
      await service.findResource({ ownerId: 'owner-a', readableId: first.readableId }),
    ).toMatchObject(updated);
  });
});

test('identity is owner + provider + kind + source ID; identical bodies do not merge unrelated items', async () => {
  await withRecords(async ({ service }) => {
    const input = { ownerId: 'owner-a', record: record() };
    const first = await service.upsert({
      change: { clientName: null, message: 'Updated test context' },
      ...input,
    });
    expect(first.state).toBe('created');
    expect(
      await service.upsert({
        change: { clientName: null, message: 'Updated test context' },
        ...input,
      }),
    ).toEqual({
      state: 'unchanged',
      readableId: first.readableId,
    });
    for (const source of [
      { provider: 'github', kind: 'pull-request', id: 'PR_2' },
      { provider: 'github', kind: 'issue', id: 'PR_1' },
      { provider: 'gitlab', kind: 'pull-request', id: 'PR_1' },
    ]) {
      expect(
        (
          await service.upsert({
            change: { clientName: null, message: 'Updated test context' },
            ...input,
            record: record({ source }),
          })
        ).state,
      ).toBe('created');
    }
    expect(
      (await service.listResources({ ownerId: 'owner-a', limit: 10, offset: 0 })).items,
    ).toHaveLength(DISTINCT_RECORD_COUNT);
    expect(
      await service.findResource({ ownerId: 'owner-b', readableId: first.readableId }),
    ).toBeNull();
    expect(
      (
        await service.upsert({
          change: { clientName: null, message: 'Updated test context' },
          ...input,
          ownerId: 'owner-b',
        })
      ).state,
    ).toBe('created');
    expect(
      (await service.listResources({ ownerId: 'owner-b', limit: 10, offset: 0 })).items,
    ).toHaveLength(1);
  });
});

test('orders normalized source timestamps and rejects ambiguous changes without overwriting data', async () => {
  await withRecords(async ({ service, dataFolder }) => {
    const publishedVersionCount = 3;
    const original = record({ sourceUpdatedAt: '2026-09-08T10:00:00+02:00' });
    const first = await service.upsert({
      change: { clientName: null, message: 'Updated test context' },
      ownerId: 'owner-a',
      record: original,
    });
    const write = (value: RecordInput) =>
      service.upsert({
        change: { clientName: null, message: 'Updated test context' },
        ownerId: 'owner-a',
        record: value,
      });
    expect((await write(record())).state).toBe('unchanged');
    expect((await write(record({ body: 'Ambiguous' }))).state).toBe('conflict');
    expect((await write(record({ body: 'Unversioned', sourceUpdatedAt: null }))).state).toBe(
      'conflict',
    );
    expect((await write(record({ sourceUpdatedAt: NEXT }))).state).toBe('updated');
    expect((await write(record({ body: 'Older edit' }))).state).toBe('stale');
    expect((await write(record({ body: 'Replacementneedle', sourceUpdatedAt: LAST }))).state).toBe(
      'updated',
    );
    expect((await write(original)).state).toBe('stale');
    expect(
      await service.findResource({ ownerId: 'owner-a', readableId: first.readableId }),
    ).toMatchObject({
      body: 'Replacementneedle',
      sourceUpdatedAt: LAST,
      createdAt: NOW,
    });
    expect(
      Array.from(
        new Bun.Glob('**/*').scanSync({ cwd: join(dataFolder, 'objects'), onlyFiles: true }),
      ),
    ).toHaveLength(publishedVersionCount);
    const unversioned = record({
      source: { provider: 'notes', kind: 'note', id: '1' },
      sourceUpdatedAt: null,
    });
    expect((await write(unversioned)).state).toBe('created');
    expect((await write(unversioned)).state).toBe('unchanged');
    expect((await write({ ...unversioned, body: 'Ambiguous' })).state).toBe('conflict');
  });
});

test('deletions hide records and search matches, and stale replays cannot resurrect them', async () => {
  await withRecords(async ({ service, database, storage }) => {
    const input = record();
    const first = await service.upsert({
      change: { clientName: null, message: 'Updated test context' },
      ownerId: 'owner-a',
      record: input,
    });
    const retrieval = createTestHypermediaRetrievalService({ database, storage });
    const search = () =>
      retrieval.search({ ownerId: 'owner-a', query: 'Originalneedle', limit: 5 });
    expect((await search()).results).toHaveLength(1);
    const deletion = { ownerId: 'owner-a', source: input.source, sourceUpdatedAt: NEXT };
    expect(
      (
        await service.remove({
          change: { clientName: null, message: 'Updated test context' },
          ...deletion,
        })
      ).state,
    ).toBe('updated');
    expect(
      (
        await service.remove({
          change: { clientName: null, message: 'Updated test context' },
          ...deletion,
        })
      ).state,
    ).toBe('unchanged');
    expect(
      (
        await service.upsert({
          change: { clientName: null, message: 'Updated test context' },
          ownerId: 'owner-a',
          record: input,
        })
      ).state,
    ).toBe('stale');
    expect(
      await service.findResource({ ownerId: 'owner-a', readableId: first.readableId }),
    ).toBeNull();
    expect((await search()).results).toEqual([]);
    expect(await service.filterOptions({ ownerId: 'owner-a' })).toEqual({
      providers: [],
      kinds: [],
    });
    expect(
      (
        await service.upsert({
          change: { clientName: null, message: 'Updated test context' },
          ownerId: 'owner-a',
          record: record({ sourceUpdatedAt: LAST }),
        })
      ).state,
    ).toBe('updated');
    expect((await search()).results).toHaveLength(1);
  });
});

test('storage integrity and search publication fail atomically; unpublished files are discarded', async () => {
  await withRecords(async ({ service, database, storage, dataFolder }) => {
    const first = await service.upsert({
      change: { clientName: null, message: 'Updated test context' },
      ownerId: 'owner-a',
      record: record(),
    });
    const retrieval = createTestHypermediaRetrievalService({ database, storage });
    await database`create trigger "fail_record_index" before insert on "hypermedia_search_document" when new."resource_type" = 'record' begin select raise(abort, 'index unavailable'); end`;
    await expect(
      service.upsert({
        change: { clientName: null, message: 'Updated test context' },
        ownerId: 'owner-a',
        record: record({ body: 'Failedneedle', sourceUpdatedAt: NEXT }),
      }),
    ).rejects.toThrow('index unavailable');
    expect(
      (await service.findResource({ ownerId: 'owner-a', readableId: first.readableId }))?.body,
    ).toBe('Originalneedle');
    expect(
      (await retrieval.search({ ownerId: 'owner-a', query: 'Failedneedle', limit: 5 })).results,
    ).toEqual([]);
    const files = Array.from(
      new Bun.Glob('**/*').scanSync({ cwd: join(dataFolder, 'objects'), onlyFiles: true }),
    );
    expect(files).toHaveLength(1);
    const [stored] = await database<
      { storageKey: string }[]
    >`select "storage_key" as "storageKey" from "record"`;
    await storage.write(stored!.storageKey, new Blob(['corrupt']));
    await expect(
      service.findResource({ ownerId: 'owner-a', readableId: first.readableId }),
    ).rejects.toThrow();
  });
});

test('independent writers deduplicate concurrently and converge on the newest source version', async () => {
  await withRecords(async ({ service, dataFolder, storage }) => {
    const otherDatabase = await createSqliteDatabase({ dataFolder });
    try {
      const other = new RecordsService({ records: new RecordsRepository(otherDatabase), storage });
      const input = { ownerId: 'owner-a', record: record() };
      const results = await Promise.all([
        service.upsert({
          change: { clientName: null, message: 'Updated test context' },
          ...input,
        }),
        other.upsert({
          change: { clientName: null, message: 'Updated test context' },
          ...input,
        }),
      ]);
      expect(results.map((result) => result.state).sort()).toEqual(['created', 'unchanged']);
      await Promise.all([
        service.upsert({
          change: { clientName: null, message: 'Updated test context' },
          ...input,
          record: record({ body: 'Middle', sourceUpdatedAt: NEXT }),
        }),
        other.upsert({
          change: { clientName: null, message: 'Updated test context' },
          ...input,
          record: record({ body: 'Newest', sourceUpdatedAt: LAST }),
        }),
      ]);
      expect(
        (await service.findResource({ ownerId: 'owner-a', readableId: results[0]!.readableId }))
          ?.body,
      ).toBe('Newest');
    } finally {
      await otherDatabase.close();
    }
  });
});

test('all callers validate the native schema, including local service calls', async () => {
  await withRecords(async ({ service }) => {
    for (const invalid of [
      record({ title: '' }),
      record({ sourceCreatedAt: 'not-a-date' }),
      { ...record(), participants: [] },
      record({ source: { provider: '', kind: 'note', id: '1' } }),
    ]) {
      await expect(
        service.upsert({
          change: { clientName: null, message: 'Updated test context' },
          ownerId: 'owner-a',
          record: invalid,
        }),
      ).rejects.toThrow();
    }
    expect(
      (await service.listResources({ ownerId: 'owner-a', limit: 10, offset: 0 })).items,
    ).toEqual([]);
  });
});

test.each(['throw', 'short'] as const)(
  'partial storage writes (%s) leave no record or unpublished file',
  async (failure) => {
    await withRecords(async ({ service, storage, dataFolder }) => {
      const write = storage.write.bind(storage);
      const brokenWrite = spyOn(storage, 'write').mockImplementation(async (...[key, data]) => {
        const bytes = await write(key, data.slice(0, 1));
        if (failure === 'throw') {
          throw new Error('Storage unavailable');
        }
        return bytes;
      });
      try {
        await expect(
          service.upsert({
            change: { clientName: null, message: 'Updated test context' },
            ownerId: 'owner-a',
            record: record(),
          }),
        ).rejects.toThrow();
        expect(
          (await service.listResources({ ownerId: 'owner-a', limit: 10, offset: 0 })).items,
        ).toEqual([]);
        expect(
          Array.from(
            new Bun.Glob('**/*').scanSync({ cwd: join(dataFolder, 'objects'), onlyFiles: true }),
          ),
        ).toEqual([]);
      } finally {
        brokenWrite.mockRestore();
      }
    });
  },
);
