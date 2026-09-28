import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';

const CONTENT_HASH_LENGTH = 64;
const EXPECTED_PAGE_COUNT = 4;

test('entity pages paginate current mentions by update within their owner', async () => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-entity-pages-'));
  const db = await createSqliteDatabase({ dataFolder });
  const createdAt = '2026-01-01T00:00:00.000Z';
  try {
    await runMigrations({ db });
    await db.begin(async (sql) => {
      for (const ownerId of ['owner-a', 'owner-b']) {
        await sql`
          insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
          values (${ownerId}, 'Owner', ${`${ownerId}@example.invalid`}, 1, ${createdAt}, ${createdAt})
        `;
        await sql`
          insert into "entity" ("id", "owner_id", "readable_id", "name", "description", "created_at", "updated_at")
          values (${ownerId}, ${ownerId}, 'subject', 'Subject', 'Test subject', ${createdAt}, ${createdAt})
        `;
        for (const [readableId, updatedAt] of [
          ['oldest', createdAt],
          ['beta', '2026-01-02T00:00:00.000Z'],
          ['alpha', '2026-01-02T00:00:00.000Z'],
          ['newest', '2026-01-03T00:00:00.000Z'],
          ['archived', '2026-01-04T00:00:00.000Z'],
          ['removed-mention', '2026-01-04T00:00:00.000Z'],
          ['unrelated', '2026-01-04T00:00:00.000Z'],
        ]) {
          await seedPage({
            sql,
            ownerId,
            readableId: readableId!,
            updatedAt: updatedAt!,
            createdAt,
          });
        }
      }
    });
    const pages = new KnowledgePagesRepository(db);
    const input = { ownerId: 'owner-a', entityReadableId: 'subject', limit: 2, offset: 0 };
    const first = await pages.list(input);
    expect(first.items.map((page) => page.readableId)).toEqual(['newest', 'alpha']);
    expect(first.total).toBe(EXPECTED_PAGE_COUNT);
    expect(first.nextOffset).toBe(2);
    const second = await pages.list({ ...input, offset: first.nextOffset! });
    expect(second.items.map((page) => page.readableId)).toEqual(['beta', 'oldest']);
    expect(second.total).toBe(EXPECTED_PAGE_COUNT);
    expect(second.nextOffset).toBeNull();
    expect(first.items.every((page) => page.id.startsWith('owner-a-'))).toBe(true);
    expect(await pages.list({ ...input, entityReadableId: 'missing' })).toEqual({
      items: [],
      total: 0,
      nextOffset: null,
    });
    await db`update "entity" set "archived_at" = ${createdAt} where "owner_id" = 'owner-a'`;
    expect(await pages.list(input)).toEqual({ items: [], total: 0, nextOffset: null });
    expect((await pages.list({ ...input, ownerId: 'owner-b' })).total).toBe(EXPECTED_PAGE_COUNT);
  } finally {
    await db.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});

async function seedPage({
  sql,
  ownerId,
  readableId,
  updatedAt,
  createdAt,
}: {
  sql: SQL;
  ownerId: string;
  readableId: string;
  updatedAt: string;
  createdAt: string;
}) {
  const id = `${ownerId}-${readableId}`;
  await sql`
            insert into "knowledge_page" ("id", "owner_id", "readable_id", "current_revision_id", "created_at", "updated_at", "archived_at")
            values (${id}, ${ownerId}, ${readableId}, ${id}, ${createdAt}, ${updatedAt}, ${readableId === 'archived' ? createdAt : null})
          `;
  for (const revisionId of readableId === 'removed-mention' ? [`${id}-old`, id] : [id]) {
    await sql`
              insert into "knowledge_page_revision"
                ("id", "page_id", "owner_id", "revision_number", "title", "excerpt", "storage_key",
                 "size_bytes", "content_hash", "author_kind", "author_name", "created_at")
              values (${revisionId}, ${id}, ${ownerId}, ${revisionId === id ? 2 : 1}, ${readableId}, '', ${revisionId},
                1, ${'a'.repeat(CONTENT_HASH_LENGTH)}, 'owner', 'Owner', ${createdAt})
            `;
    if (readableId !== 'unrelated' && !(readableId === 'removed-mention' && revisionId === id)) {
      await sql`
                insert into "knowledge_page_entity_mention" ("owner_id", "source_revision_id", "target_entity_id")
                values (${ownerId}, ${revisionId}, ${ownerId})
              `;
    }
  }
}
