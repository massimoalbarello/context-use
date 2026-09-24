import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { isReadableId } from '#backend/models/readable-ids/model.ts';
import { createPublicId } from '#backend/repositories/publications/public-id.ts';
import { PublicationsRepository } from '#backend/repositories/publications/repository.ts';

const NOW = '2026-09-24T09:00:00.000Z';
const LATER = '2026-09-24T10:00:00.000Z';
const CONTENT_HASH_LENGTH = 64;
const HASH = 'a'.repeat(CONTENT_HASH_LENGTH);
const RESOURCES = [
  { type: 'page', table: 'knowledge_page', status: 'pageStatus' },
  { type: 'entity', table: 'entity', status: 'entityStatus' },
  { type: 'asset', table: 'asset', status: 'assetStatus' },
] as const;

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

async function withDatabase(run: (database: SQL) => Promise<void>) {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-publications-'));
  const database = await createSqliteDatabase({ dataFolder });
  try {
    await runMigrations({ db: database });
    await seedOwner({ database, ownerId: 'owner-a' });
    await seedOwner({ database, ownerId: 'owner-b' });
    await run(database);
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
}

for (const { type, table, status } of RESOURCES) {
  test(`${type} status is private by default and retains its separate public identity across withdrawal`, async () => {
    await withDatabase(async (database) => {
      const repository = new PublicationsRepository(database);
      const input = { ownerId: 'owner-a', readableId: 'primary' };
      const resourceId = `owner-a-${type}-primary`;
      const publicId = createPublicId(type);
      const privateStatus = {
        publicId: null,
        publishedAt: null,
        ...(type === 'page' ? { revisionId: null } : {}),
      };
      const activeRevision = type === 'page' ? { revisionId: `${resourceId}-revision` } : {};
      expect(await repository[status](input)).toEqual(privateStatus);
      expect(await repository[status]({ ...input, readableId: 'missing' })).toBeNull();
      expect(await repository[status]({ ...input, ownerId: 'missing-owner' })).toBeNull();
      expect(isReadableId(publicId)).toBe(false);
      expect(publicId).not.toBe(resourceId);

      await database.unsafe(
        `insert into "${table}_publication" ("${type}_id", "owner_id", "public_id") values ($1, $2, $3)`,
        [resourceId, input.ownerId, publicId],
      );
      expect(await repository[status](input)).toEqual({ ...privateStatus, publicId });
      const publish = () =>
        database.unsafe(
          `update "${table}_publication" set "published_at" = $1${type === 'page' ? ', "revision_id" = $2' : ''}
         where "${type}_id" = ${type === 'page' ? '$3' : '$2'}`,
          type === 'page' ? [NOW, `${resourceId}-revision`, resourceId] : [NOW, resourceId],
        );
      await publish();
      expect(await repository[status](input)).toEqual({
        publicId,
        publishedAt: NOW,
        ...activeRevision,
      });
      expect(await repository[status]({ ...input, ownerId: 'owner-b' })).toEqual(privateStatus);
      for (const readableId of [resourceId, publicId]) {
        expect(await repository[status]({ ...input, readableId })).toBeNull();
      }

      await database.unsafe(
        `update "${table}_publication" set "published_at" = null${type === 'page' ? ', "revision_id" = null' : ''}
         where "${type}_id" = $1`,
        [resourceId],
      );
      expect(await repository[status](input)).toEqual({ ...privateStatus, publicId });
      await publish();
      expect(await repository[status](input)).toEqual({
        publicId,
        publishedAt: NOW,
        ...activeRevision,
      });
    });
  });

  test(`${type} publication enforces ownership, public identity, uniqueness, and resource cleanup`, async () => {
    await withDatabase(async (database) => {
      const resourceId = `owner-a-${type}-primary`;
      const publicId = createPublicId(type);
      const insert = async ({ id = resourceId, owner = 'owner-a', handle = publicId } = {}) =>
        database.unsafe(
          `insert into "${table}_publication" ("${type}_id", "owner_id", "public_id") values ($1, $2, $3)`,
          [id, owner, handle],
        );
      await expect(insert({ owner: 'owner-b' })).rejects.toThrow('FOREIGN KEY');
      await expect(insert({ id: 'missing-resource' })).rejects.toThrow('FOREIGN KEY');
      for (const handle of [
        'primary',
        resourceId,
        createPublicId(type === 'asset' ? 'entity' : 'asset'),
      ]) {
        await expect(insert({ handle })).rejects.toThrow('CHECK');
      }
      await insert();
      await expect(insert({ handle: createPublicId(type) })).rejects.toThrow('UNIQUE');
      await expect(insert({ id: `owner-a-${type}-secondary` })).rejects.toThrow('UNIQUE');
      await expect(insert({ id: `owner-b-${type}-primary`, owner: 'owner-b' })).rejects.toThrow(
        'UNIQUE',
      );
      await expect(
        Promise.resolve(
          database.unsafe(
            `update "${table}_publication" set "published_at" = ' ' where "${type}_id" = $1`,
            [resourceId],
          ),
        ),
      ).rejects.toThrow('CHECK');

      // Even a private database ID that happens to use the public syntax cannot be reused.
      await database.begin(async (db) => {
        await db.unsafe(`update "${table}" set "id" = $1 where "id" = $2`, [
          `${type}_private-database-id`,
          `owner-a-${type}-secondary`,
        ]);
        if (type === 'page') {
          await db`update "knowledge_page_revision" set "page_id" = 'page_private-database-id' where "page_id" = 'owner-a-page-secondary'`;
        }
      });
      await expect(
        insert({ id: `${type}_private-database-id`, handle: `${type}_private-database-id` }),
      ).rejects.toThrow('CHECK');

      await insert({
        id: `owner-b-${type}-primary`,
        owner: 'owner-b',
        handle: createPublicId(type),
      });
      await database.unsafe(`delete from "${table}" where "id" = $1`, [resourceId]);
      const retained = await database.unsafe(`select "owner_id" from "${table}_publication"`);
      expect([...retained]).toEqual([{ owner_id: 'owner-b' }]);
      await database`delete from "auth_user" where "id" = 'owner-b'`;
      const removed = await database.unsafe(`select "owner_id" from "${table}_publication"`);
      expect([...removed]).toEqual([]);
    });
  });
}

test('a page publication selects exactly one revision of its own page and survives newer private revisions', async () => {
  await withDatabase(async (database) => {
    const repository = new PublicationsRepository(database);
    const input = { ownerId: 'owner-a', readableId: 'primary' };
    const publicId = createPublicId('page');
    await database`
      insert into "knowledge_page_publication" ("page_id", "owner_id", "public_id")
      values ('owner-a-page-primary', 'owner-a', ${publicId})
    `;
    await expect(
      Promise.resolve(database`
      update "knowledge_page_publication" set "published_at" = ${NOW}
    `),
    ).rejects.toThrow('CHECK');
    await expect(
      Promise.resolve(database`
      update "knowledge_page_publication" set "revision_id" = 'owner-a-page-primary-revision'
    `),
    ).rejects.toThrow('CHECK');
    for (const revisionId of [
      'missing-revision',
      'owner-a-page-secondary-revision',
      'owner-b-page-primary-revision',
    ]) {
      await expect(
        Promise.resolve(database`
        update "knowledge_page_publication" set "published_at" = ${NOW}, "revision_id" = ${revisionId}
      `),
      ).rejects.toThrow('FOREIGN KEY');
    }
    await database`
      update "knowledge_page_publication" set "published_at" = ${NOW}, "revision_id" = 'owner-a-page-primary-revision'
    `;
    await database.begin(async (db) => {
      await db`
        insert into "knowledge_page_revision"
          ("id", "page_id", "owner_id", "revision_number", "title", "excerpt", "storage_key",
           "size_bytes", "content_hash", "author_kind", "author_name", "created_at")
        values ('new-revision', 'owner-a-page-primary', 'owner-a', 2, 'New private title', '', 'new-revision', 1, ${HASH}, 'owner', 'Owner', ${LATER})
      `;
      await db`
        update "knowledge_page" set "current_revision_id" = 'new-revision', "updated_at" = ${LATER}
        where "id" = 'owner-a-page-primary'
      `;
    });
    expect(await repository.pageStatus(input)).toEqual({
      publicId,
      publishedAt: NOW,
      revisionId: 'owner-a-page-primary-revision',
    });
    await expect(
      Promise.resolve(
        database`delete from "knowledge_page_revision" where "id" = 'owner-a-page-primary-revision'`,
      ),
    ).rejects.toThrow('FOREIGN KEY');
    await database`
      update "knowledge_page_publication" set "revision_id" = 'new-revision', "published_at" = ${LATER}
    `;
    expect(await repository.pageStatus(input)).toEqual({
      publicId,
      publishedAt: LATER,
      revisionId: 'new-revision',
    });
    await database`delete from "knowledge_page_revision" where "id" = 'owner-a-page-primary-revision'`;
    await database`delete from "knowledge_page" where "id" = 'owner-a-page-primary'`;
    const removed = await database`select "public_id" from "knowledge_page_publication"`;
    expect([...removed]).toEqual([]);
  });
});
