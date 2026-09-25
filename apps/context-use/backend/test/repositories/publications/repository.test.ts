import { expect, test } from 'bun:test';
import { createPublicId } from '#backend/repositories/publications/public-id.ts';
import { PublicationsRepository } from '#backend/repositories/publications/repository.ts';

import { HASH, LATER, NOW, withDatabase } from './database.ts';

const RESOURCES = [
  { type: 'page', table: 'knowledge_page', status: 'pageStatus' },
  { type: 'entity', table: 'entity', status: 'entityStatus' },
  { type: 'asset', table: 'asset', status: 'assetStatus' },
] as const;

for (const { type, table, status } of RESOURCES) {
  test(`${type} status is private by default and retains its separate public identity across withdrawal`, async () => {
    await withDatabase(async ({ database }) => {
      const repository = new PublicationsRepository(database);
      const input = { ownerId: 'owner-a', readableId: 'primary' };
      const resourceId = `owner-a-${type}-primary`;
      const publicId = createPublicId();
      const privateStatus = {
        publicId: null,
        publishedAt: null,
        ...(type === 'page' ? { publishedRevisionNumber: null } : {}),
      };
      const activeRevision = type === 'page' ? { publishedRevisionNumber: 1 } : {};
      expect(await repository[status](input)).toEqual(privateStatus);
      expect(await repository[status]({ ...input, readableId: 'missing' })).toBeNull();
      expect(await repository[status]({ ...input, ownerId: 'missing-owner' })).toBeNull();
      expect(publicId).not.toBe(resourceId);

      await database.unsafe(
        `update "${table}" set "public_id" = $1 where "id" = $2 and "owner_id" = $3`,
        [publicId, resourceId, input.ownerId],
      );
      expect(await repository[status](input)).toEqual({ ...privateStatus, publicId });
      const publish = () =>
        database.unsafe(
          `update "${table}" set "published_at" = $1${type === 'page' ? ', "published_revision_id" = $2' : ''}
         where "id" = ${type === 'page' ? '$3' : '$2'}`,
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

      await expect(
        Promise.resolve(
          database.unsafe(`update "${table}" set "public_id" = null where "id" = $1`, [resourceId]),
        ),
      ).rejects.toThrow('CHECK');

      await database.unsafe(
        `update "${table}" set "published_at" = null${type === 'page' ? ', "published_revision_id" = null' : ''}
         where "id" = $1`,
        [resourceId],
      );
      expect(await repository[status](input)).toEqual({ ...privateStatus, publicId });
      await publish();
      expect(await repository[status](input)).toEqual({
        publicId,
        publishedAt: NOW,
        ...activeRevision,
      });
      await database.unsafe(`update "${table}" set "archived_at" = $1 where "id" = $2`, [
        LATER,
        resourceId,
      ]);
      expect(await repository[status](input)).toBeNull();
    });
  });

  test(`${type} publication enforces ownership, public identity, uniqueness, and resource cleanup`, async () => {
    await withDatabase(async ({ database }) => {
      const resourceId = `owner-a-${type}-primary`;
      const publicId = createPublicId();
      const reserve = async ({ id = resourceId, owner = 'owner-a', handle = publicId } = {}) =>
        database.unsafe(
          `update "${table}" set "public_id" = $1 where "id" = $2 and "owner_id" = $3`,
          [handle, id, owner],
        );
      await reserve({ owner: 'owner-b' });
      await reserve({ id: 'missing-resource' });
      expect(
        await new PublicationsRepository(database)[status]({
          ownerId: 'owner-a',
          readableId: 'primary',
        }),
      ).toEqual({
        publicId: null,
        publishedAt: null,
        ...(type === 'page' ? { publishedRevisionNumber: null } : {}),
      });
      for (const handle of [
        'primary',
        resourceId,
        `${type}_${publicId}`,
        `A${publicId.slice(1)}`,
        publicId.replaceAll('-', ''),
        publicId.replace('-', 'a'),
        `${publicId.slice(0, -1)}-`,
        `g${publicId.slice(1)}`,
        `${publicId}0`,
      ]) {
        await expect(reserve({ handle })).rejects.toThrow('CHECK');
      }
      await expect(
        Promise.resolve(
          database.unsafe(
            `update "${table}" set "published_at" = $1${type === 'page' ? ', "published_revision_id" = $2' : ''} where "id" = ${type === 'page' ? '$3' : '$2'}`,
            type === 'page' ? [NOW, `${resourceId}-revision`, resourceId] : [NOW, resourceId],
          ),
        ),
      ).rejects.toThrow('CHECK');
      await reserve();
      await expect(reserve({ id: `owner-a-${type}-secondary` })).rejects.toThrow('UNIQUE');
      await expect(reserve({ id: `owner-b-${type}-primary`, owner: 'owner-b' })).rejects.toThrow(
        'UNIQUE',
      );
      await expect(
        Promise.resolve(
          database.unsafe(`update "${table}" set "published_at" = ' ' where "id" = $1`, [
            resourceId,
          ]),
        ),
      ).rejects.toThrow('CHECK');

      // Even a private database ID that happens to use the public syntax cannot be reused.
      const privateId = crypto.randomUUID();
      await database.begin(async (db) => {
        await db.unsafe(`update "${table}" set "id" = $1 where "id" = $2`, [
          privateId,
          `owner-a-${type}-secondary`,
        ]);
        if (type === 'page') {
          await db`update "knowledge_page_revision" set "page_id" = ${privateId} where "page_id" = 'owner-a-page-secondary'`;
        }
      });
      await expect(reserve({ id: privateId, handle: privateId })).rejects.toThrow('CHECK');
      const readableId = crypto.randomUUID();
      await database.unsafe(`update "${table}" set "readable_id" = $1 where "id" = $2`, [
        readableId,
        privateId,
      ]);
      await expect(reserve({ id: privateId, handle: readableId })).rejects.toThrow('CHECK');

      await reserve({
        id: `owner-b-${type}-primary`,
        owner: 'owner-b',
        handle: createPublicId(),
      });
      await database.unsafe(`delete from "${table}" where "id" = $1`, [resourceId]);
      const retained = await database.unsafe(
        `select "owner_id" from "${table}" where "public_id" is not null`,
      );
      expect([...retained]).toEqual([{ owner_id: 'owner-b' }]);
      await database`delete from "auth_user" where "id" = 'owner-b'`;
      const removed = await database.unsafe(
        `select "owner_id" from "${table}" where "public_id" is not null`,
      );
      expect([...removed]).toEqual([]);
    });
  });
}

test('a page publication selects exactly one revision of its own page and survives newer private revisions', async () => {
  await withDatabase(async ({ database }) => {
    const repository = new PublicationsRepository(database);
    const input = { ownerId: 'owner-a', readableId: 'primary' };
    const publicId = createPublicId();
    await database`
      update "knowledge_page" set "public_id" = ${publicId}
      where "id" = 'owner-a-page-primary' and "owner_id" = 'owner-a'
    `;
    await expect(
      Promise.resolve(database`
      update "knowledge_page" set "published_at" = ${NOW}
      where "id" = 'owner-a-page-primary' and "owner_id" = 'owner-a'
    `),
    ).rejects.toThrow('CHECK');
    await expect(
      Promise.resolve(database`
      update "knowledge_page" set "published_revision_id" = 'owner-a-page-primary-revision'
      where "id" = 'owner-a-page-primary' and "owner_id" = 'owner-a'
    `),
    ).rejects.toThrow('CHECK');
    for (const revisionId of [
      'missing-revision',
      'owner-a-page-secondary-revision',
      'owner-b-page-primary-revision',
    ]) {
      await expect(
        Promise.resolve(database`
        update "knowledge_page" set "published_at" = ${NOW}, "published_revision_id" = ${revisionId}
        where "id" = 'owner-a-page-primary' and "owner_id" = 'owner-a'
      `),
      ).rejects.toThrow('FOREIGN KEY');
    }
    await database`
      update "knowledge_page" set "published_at" = ${NOW}, "published_revision_id" = 'owner-a-page-primary-revision'
      where "id" = 'owner-a-page-primary' and "owner_id" = 'owner-a'
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
      publishedRevisionNumber: 1,
    });
    await expect(
      Promise.resolve(
        database`delete from "knowledge_page_revision" where "id" = 'owner-a-page-primary-revision'`,
      ),
    ).rejects.toThrow('FOREIGN KEY');
    await database`
      update "knowledge_page" set "published_revision_id" = 'new-revision', "published_at" = ${LATER}
      where "id" = 'owner-a-page-primary' and "owner_id" = 'owner-a'
    `;
    expect(await repository.pageStatus(input)).toEqual({
      publicId,
      publishedAt: LATER,
      publishedRevisionNumber: 2,
    });
    await database`delete from "knowledge_page_revision" where "id" = 'owner-a-page-primary-revision'`;
    await database`delete from "knowledge_page" where "id" = 'owner-a-page-primary'`;
    const removed =
      await database`select "public_id" from "knowledge_page" where "public_id" is not null`;
    expect([...removed]).toEqual([]);
  });
});
