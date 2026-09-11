import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';

const NOW = '2026-09-11T09:00:00.000Z';
const CONTENT_HASH_LENGTH = 64;
const HASH = 'a'.repeat(CONTENT_HASH_LENGTH);
const RELATIONSHIPS = [
  {
    table: 'knowledge_page_entity_mention',
    kind: 'entity',
    targetColumn: 'target_entity_id',
    targetKey: 'id',
    qualifier: null,
  },
  {
    table: 'knowledge_page_reference',
    kind: 'knowledge_page',
    targetColumn: 'target_page_id',
    targetKey: 'id',
    qualifier: { column: 'target_fragment', value: '', alternative: 'evidence' },
  },
  {
    table: 'knowledge_page_asset_usage',
    kind: 'asset',
    targetColumn: 'target_asset_id',
    targetKey: 'id',
    qualifier: { column: 'presentation', value: 'attachment', alternative: 'embed' },
  },
  {
    table: 'knowledge_page_record_reference',
    kind: 'record',
    targetColumn: 'target_record_readable_id',
    targetKey: 'readable_id',
    qualifier: null,
  },
] as const;

async function seedOwner({ database, ownerId }: { database: SQL; ownerId: string }) {
  await database.begin(async (db) => {
    await db`
      insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values (${ownerId}, ${ownerId}, ${`${ownerId}@example.invalid`}, 1, ${NOW}, ${NOW})
    `;
    for (const name of ['source', 'knowledge_page']) {
      const id = `${ownerId}-${name}`;
      await db`
        insert into "knowledge_page" ("id", "owner_id", "readable_id", "current_revision_id", "created_at", "updated_at")
        values (${id}, ${ownerId}, ${id.replaceAll('_', '-')}, ${`${id}-revision`}, ${NOW}, ${NOW})
      `;
      await db`
        insert into "knowledge_page_revision"
          ("id", "page_id", "owner_id", "revision_number", "title", "excerpt", "storage_key",
           "size_bytes", "content_hash", "author_kind", "author_name", "created_at")
        values (${`${id}-revision`}, ${id}, ${ownerId}, 1, 'Page', '', ${id}, 1, ${HASH}, 'owner', 'Owner', ${NOW})
      `;
    }
    await db`
      insert into "entity" ("id", "owner_id", "readable_id", "name", "description", "created_at", "updated_at")
      values (${`${ownerId}-entity`}, ${ownerId}, 'entity', 'Entity', 'Test entity', ${NOW}, ${NOW})
    `;
    await db`
      insert into "asset" ("id", "owner_id", "readable_id", "name", "media_type", "size_bytes", "content_hash", "storage_key", "created_at", "updated_at")
      values (${`${ownerId}-asset`}, ${ownerId}, 'asset', 'Asset', 'text/plain', 1, ${HASH}, ${`${ownerId}/asset`}, ${NOW}, ${NOW})
    `;
    const syncId = Bun.randomUUIDv7();
    const keyHash = new Bun.CryptoHasher('sha256').update(ownerId).digest('hex');
    await db`
      insert into "record_sync" ("id", "owner_id", "readable_id", "name", "api_key_sha256", "created_at")
      values (${syncId}, ${ownerId}, 'sync', 'Sync', ${keyHash}, ${NOW})
    `;
    await db`
      insert into "record"
        ("sync_id", "owner_id", "readable_id", "source_id", "kind", "record_id", "provider", "title",
         "revision", "operation", "revision_hash", "storage_key", "content_hash", "size_bytes", "created_at", "updated_at")
      values (${syncId}, ${ownerId}, ${`${ownerId}-record`}, 'source', 'note', 'record', 'notion', 'Record',
        1, 'added', ${HASH}, ${`${ownerId}/record`}, ${HASH}, 1, ${NOW}, ${NOW})
    `;
  });
}

for (const relationship of RELATIONSHIPS) {
  test(`${relationship.table} enforces ownership, uniqueness, and cascading cleanup`, async () => {
    const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-page-links-'));
    const database = await createSqliteDatabase({ dataFolder });
    try {
      await runMigrations({ db: database });
      await seedOwner({ database, ownerId: 'owner-a' });
      await seedOwner({ database, ownerId: 'owner-b' });
      const { table, kind, targetColumn, targetKey, qualifier } = relationship;
      const insert = async ({
        ownerId,
        revisionId,
        targetId,
        value = qualifier?.value,
      }: {
        ownerId: string;
        revisionId: string;
        targetId: string;
        value?: string;
      }) =>
        database.unsafe(
          `insert into "${table}" ("owner_id", "source_revision_id", "${targetColumn}"${qualifier ? `, "${qualifier.column}"` : ''})
           values ($1, $2, $3${qualifier ? ', $4' : ''})`,
          qualifier ? [ownerId, revisionId, targetId, value!] : [ownerId, revisionId, targetId],
        );
      const rows = (ownerId: string) =>
        database.unsafe(`select "source_revision_id" from "${table}" where "owner_id" = $1`, [
          ownerId,
        ]);
      const source = 'owner-a-source-revision';
      const target = `owner-a-${kind}`;
      const reference = { ownerId: 'owner-a', revisionId: source, targetId: target };
      await insert(reference);
      await expect(insert(reference)).rejects.toThrow('UNIQUE');
      await expect(insert({ ...reference, revisionId: 'owner-b-source-revision' })).rejects.toThrow(
        'FOREIGN KEY',
      );
      await expect(insert({ ...reference, targetId: `owner-b-${kind}` })).rejects.toThrow(
        'FOREIGN KEY',
      );
      await expect(insert({ ...reference, revisionId: 'missing-revision' })).rejects.toThrow(
        'FOREIGN KEY',
      );
      await expect(insert({ ...reference, targetId: 'missing-target' })).rejects.toThrow(
        'FOREIGN KEY',
      );
      await insert({
        ownerId: 'owner-b',
        revisionId: 'owner-b-source-revision',
        targetId: `owner-b-${kind}`,
      });
      if (qualifier) {
        await insert({ ...reference, value: qualifier.alternative });
        expect(await rows('owner-a')).toHaveLength(2);
      }

      await database`
        insert into "knowledge_page_revision"
          ("id", "page_id", "owner_id", "revision_number", "title", "excerpt", "storage_key",
           "size_bytes", "content_hash", "author_kind", "author_name", "created_at")
        select 'other-revision', "page_id", "owner_id", 2, "title", "excerpt", 'other-revision',
          "size_bytes", "content_hash", "author_kind", "author_name", "created_at"
        from "knowledge_page_revision" where "id" = ${source}
      `;
      await insert({ ...reference, revisionId: 'other-revision' });
      await database`delete from "knowledge_page_revision" where "id" = 'other-revision'`;
      expect(await rows('owner-a')).toEqual(
        Array(qualifier ? 2 : 1).fill({ source_revision_id: source }),
      );

      await database.unsafe(`delete from "${kind}" where "owner_id" = $1 and "${targetKey}" = $2`, [
        'owner-a',
        target,
      ]);
      expect(await rows('owner-a')).toEqual([]);
      expect(await rows('owner-b')).toHaveLength(1);
      await database`delete from "knowledge_page" where "id" = 'owner-b-source'`;
      expect(await rows('owner-b')).toEqual([]);
    } finally {
      await database.close();
      await rm(dataFolder, { recursive: true, force: true });
    }
  });
}
