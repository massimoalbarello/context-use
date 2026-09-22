import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import type { ChangeContext } from '#backend/models/history/model.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';
import { HistoryRepository } from '#backend/repositories/history/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { RecordsService } from '#backend/services/records/service.ts';

const NOW = '2026-09-21T12:00:00.000Z';
const change: ChangeContext = {
  clientName: null,
  message: 'Corrected the company identity',
};

async function withHistory(
  run: (input: {
    entities: EntitiesRepository;
    history: HistoryRepository;
    records: RecordsService;
  }) => Promise<void>,
) {
  const folder = await mkdtemp(join(tmpdir(), 'context-use-history-test-'));
  const database = await createSqliteDatabase({ dataFolder: folder });
  try {
    await runMigrations({ db: database });
    for (const owner of ['owner-a', 'owner-b']) {
      await database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${owner}, ${owner}, ${`${owner}@example.invalid`}, 1, ${NOW}, ${NOW})`;
    }
    await run({
      entities: new EntitiesRepository(database),
      history: new HistoryRepository(database),
      records: new RecordsService({
        records: new RecordsRepository(database),
        storage: new LocalStorage(join(folder, 'objects')),
        now: () => new Date(NOW),
      }),
    });
  } finally {
    await database.close();
    await rm(folder, { recursive: true, force: true });
  }
}

function entity({ ownerId, readableId }: { ownerId: string; readableId: string }) {
  return {
    id: Bun.randomUUIDv7(),
    ownerId,
    readableId,
    name: readableId,
    description: 'An organization in my context',
    createdAt: NOW,
    change,
  };
}

test('history is owner scoped and cursor paging survives new writes and equal timestamps', async () => {
  await withHistory(async ({ entities, history, records }) => {
    await entities.create(entity({ ownerId: 'owner-a', readableId: 'first' }));
    await records.upsert({
      ownerId: 'owner-a',
      record: {
        source: { provider: 'github', kind: 'issue', id: '1' },
        title: 'Interleaved record',
        body: 'Details',
        sourceUpdatedAt: NOW,
      },
      change,
    });
    await entities.create(entity({ ownerId: 'owner-b', readableId: 'private' }));
    await entities.create(entity({ ownerId: 'owner-a', readableId: 'second' }));
    const first = await history.list({ ownerId: 'owner-a', limit: 1, resourceType: 'entity' });
    expect(first.items.map((item) => item.name)).toEqual(['second']);
    expect(first.next).not.toBeNull();
    await entities.create(entity({ ownerId: 'owner-a', readableId: 'new-arrival' }));
    const second = await history.list({
      ownerId: 'owner-a',
      limit: 1,
      before: first.next!,
      resourceType: 'entity',
    });
    expect(second.items.map((item) => item.name)).toEqual(['first']);
    expect(second.next).toBeNull();
    expect(
      (await history.list({ ownerId: 'owner-b', limit: 10 })).items.map((item) => item.name),
    ).toEqual(['private']);
    expect(
      (await history.list({ ownerId: 'owner-a', limit: 10, resourceType: 'record' })).items.map(
        (item) => item.name,
      ),
    ).toEqual(['Interleaved record']);
    expect(
      (await history.list({ ownerId: 'owner-b', limit: 10, resourceType: 'record' })).items,
    ).toEqual([]);
    expect(
      (await history.list({ ownerId: 'owner-a', limit: 10 })).items.map((item) => item.name),
    ).toEqual(['new-arrival', 'second', 'Interleaved record', 'first']);
  });
});

test('record deletions retain the last title and stale or duplicate deliveries do not create events', async () => {
  await withHistory(async ({ records, history }) => {
    const record = {
      source: { provider: 'github', kind: 'issue', id: '123' },
      title: 'Fix sync retries',
      body: 'Initial report',
      sourceUpdatedAt: NOW,
    };
    await records.upsert({ ownerId: 'owner-a', record, change });
    await records.upsert({ ownerId: 'owner-a', record, change });
    await records.remove({
      ownerId: 'owner-a',
      source: record.source,
      sourceUpdatedAt: '2026-09-22T12:00:00.000Z',
      change,
    });
    await records.upsert({ ownerId: 'owner-a', record, change });
    const result = await history.list({ ownerId: 'owner-a', limit: 10 });
    expect(result.items.map((item) => [item.action, item.name, item.available])).toEqual([
      ['deleted', 'Fix sync retries', false],
      ['created', 'Fix sync retries', false],
    ]);
  });
});
