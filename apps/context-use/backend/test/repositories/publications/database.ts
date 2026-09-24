import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';

export const NOW = '2026-09-24T09:00:00.000Z';
export const LATER = '2026-09-24T10:00:00.000Z';
const CONTENT_HASH_LENGTH = 64;
export const HASH = 'a'.repeat(CONTENT_HASH_LENGTH);

async function seedOwner({ database, ownerId }: { database: SQL; ownerId: string }) {
  await database.begin(async (db) => {
    await db`
      insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values (${ownerId}, 'Owner', ${`${ownerId}@example.invalid`}, 1, ${NOW}, ${NOW})
    `;
    for (const name of ['primary', 'secondary']) {
      const pageId = `${ownerId}-page-${name}`;
      const entityId = `${ownerId}-entity-${name}`;
      const assetId = `${ownerId}-asset-${name}`;
      await db`
        insert into "knowledge_page" ("id", "owner_id", "readable_id", "current_revision_id", "created_at", "updated_at")
        values (${pageId}, ${ownerId}, ${name}, ${`${pageId}-revision`}, ${NOW}, ${NOW})
      `;
      await db`
        insert into "knowledge_page_revision"
          ("id", "page_id", "owner_id", "revision_number", "title", "excerpt", "storage_key",
           "size_bytes", "content_hash", "author_kind", "author_name", "created_at")
        values (${`${pageId}-revision`}, ${pageId}, ${ownerId}, 1, 'Page', '', ${pageId}, 1, ${HASH}, 'owner', 'Owner', ${NOW})
      `;
      await db`
        insert into "entity" ("id", "owner_id", "readable_id", "name", "description", "created_at", "updated_at")
        values (${entityId}, ${ownerId}, ${name}, 'Entity', 'Test entity', ${NOW}, ${NOW})
      `;
      await db`
        insert into "asset" ("id", "owner_id", "readable_id", "name", "media_type", "size_bytes", "content_hash", "storage_key", "created_at", "updated_at")
        values (${assetId}, ${ownerId}, ${name}, 'Asset', 'text/plain', 1, ${HASH}, ${assetId}, ${NOW}, ${NOW})
      `;
    }
  });
}

export async function withDatabase(
  run: (input: { database: SQL; dataFolder: string }) => Promise<void>,
) {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-publications-'));
  const database = await createSqliteDatabase({ dataFolder });
  try {
    await runMigrations({ db: database });
    await seedOwner({ database, ownerId: 'owner-a' });
    await seedOwner({ database, ownerId: 'owner-b' });
    await run({ database, dataFolder });
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
}
