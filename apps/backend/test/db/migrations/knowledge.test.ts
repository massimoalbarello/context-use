import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

const KNOWLEDGE_MIGRATION = new URL(
  '../../../src/db/migrations/0001_knowledge.sql',
  import.meta.url,
);
const CONTENT_HASH_LENGTH = 64;

test('knowledge revisions require a lowercase hexadecimal SHA-256 hash', async () => {
  const database = new Database(':memory:');

  try {
    database.exec(await Bun.file(KNOWLEDGE_MIGRATION).text());

    expect(() =>
      database.run(
        `insert into "knowledge_page_revision"
          ("id", "page_id", "owner_id", "revision_number", "title", "excerpt",
           "storage_key", "size_bytes", "content_hash", "created_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'revision-id',
          'page-id',
          'owner-id',
          1,
          'Title',
          'Excerpt',
          'storage-key',
          1,
          `a${'g'.repeat(CONTENT_HASH_LENGTH - 1)}`,
          '2026-01-01T00:00:00.000Z',
        ],
      ),
    ).toThrow();
  } finally {
    database.close();
  }
});
