import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';

const CONTENT_HASH_LENGTH = 64;
const EXPECTED_RESOURCE_COUNT = 4;

for (const Repository of [EntitiesRepository, KnowledgePagesRepository, AssetsRepository]) {
  test(`${Repository.name} orders by last update before pagination with stable timestamp ties`, async () => {
    const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-collection-order-'));
    const database = await createSqliteDatabase({ dataFolder });
    try {
      await runMigrations({ db: database });
      await database.begin(async (db) => {
        const createdAt = '2026-01-01T00:00:00.000Z';
        await db`
          insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
          values ('owner', 'Owner', 'owner@example.invalid', 1, ${createdAt}, ${createdAt})
        `;
        // Alphabetical order, insertion order and page coverage all disagree with update order.
        for (const [readableId, updatedAt] of [
          ['zulu', '2026-01-04T00:00:00.000Z'],
          ['alpha', '2026-01-02T00:00:00.000Z'],
          ['gamma', '2026-01-03T00:00:00.000Z'],
          ['beta', '2026-01-03T00:00:00.000Z'],
        ] as const) {
          await db`
            insert into "entity" ("id", "owner_id", "readable_id", "name", "description", "created_at", "updated_at")
            values (${readableId}, 'owner', ${readableId}, ${readableId}, 'Test entity', ${createdAt}, ${updatedAt})
          `;
          await db`
            insert into "asset" ("id", "owner_id", "readable_id", "name", "media_type", "size_bytes", "content_hash", "storage_key", "created_at", "updated_at")
            values (${readableId}, 'owner', ${readableId}, ${readableId}, 'text/plain', 1, ${'a'.repeat(CONTENT_HASH_LENGTH)}, ${readableId}, ${createdAt}, ${updatedAt})
          `;
          await db`
            insert into "knowledge_page" ("id", "owner_id", "readable_id", "current_revision_id", "created_at", "updated_at")
            values (${readableId}, 'owner', ${readableId}, ${readableId}, ${createdAt}, ${updatedAt})
          `;
          await db`
            insert into "knowledge_page_revision"
              ("id", "page_id", "owner_id", "revision_number", "title", "excerpt", "storage_key",
               "size_bytes", "content_hash", "author_kind", "author_name", "created_at",
               "temporal_coverage", "temporal_start_ms")
            values (${readableId}, ${readableId}, 'owner', 1, ${readableId}, '', ${readableId},
              1, ${'a'.repeat(CONTENT_HASH_LENGTH)}, 'owner', 'Owner', ${createdAt},
              ${readableId === 'alpha' ? '2026/..' : null}, ${readableId === 'alpha' ? Date.parse(createdAt) : null})
          `;
        }
      });
      const repository = new Repository(database);
      const list = (offset: number) => repository.list({ ownerId: 'owner', limit: 2, offset });
      const first = await list(0);
      expect(first.total).toBe(EXPECTED_RESOURCE_COUNT);
      expect(first.nextOffset).toBe(2);
      const second = await list(first.nextOffset!);
      expect(second.nextOffset).toBeNull();
      const items = [...first.items, ...second.items];
      expect(items[0]?.readableId).toBe('zulu');
      expect(items.at(-1)?.readableId).toBe('alpha');
      expect(
        items
          .slice(1, -1)
          .map((item) => item.readableId)
          .sort(),
      ).toEqual(['beta', 'gamma']);
      expect(await list(0)).toEqual(first);
      expect(await list(2)).toEqual(second);
    } finally {
      await database.close();
      await rm(dataFolder, { recursive: true, force: true });
    }
  });
}
