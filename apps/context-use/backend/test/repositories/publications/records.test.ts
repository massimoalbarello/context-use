import { expect, test } from 'bun:test';
import { createPublicId } from '#backend/repositories/publications/public-id.ts';
import { PublicationsRepository } from '#backend/repositories/publications/repository.ts';
import { HASH, NOW, withDatabase } from './database.ts';

test('record public IDs enforce UUID syntax, private identity separation, and global uniqueness', async () => {
  await withDatabase(async ({ database }) => {
    const readableId = crypto.randomUUID();
    for (const ownerId of ['owner-a', 'owner-b']) {
      await database`
        insert into "record" ("owner_id", "readable_id", "provider", "kind", "source_id",
          "title", "storage_key", "content_hash", "size_bytes", "created_at", "updated_at")
        values (${ownerId}, ${readableId}, 'test', 'note', 'source', 'Record',
          ${`${ownerId}/record.md`}, ${HASH}, 1, ${NOW}, ${NOW})
      `;
    }
    const publicId = createPublicId();
    const reserve = ({ handle, ownerId = 'owner-a' }: { handle: string; ownerId?: string }) =>
      database`
        update "record" set "public_id" = ${handle}
        where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
      `;
    for (const handle of [
      readableId,
      `record_${publicId}`,
      `A${publicId.slice(1)}`,
      publicId.replaceAll('-', ''),
      publicId.replace('-', 'a'),
      `${publicId.slice(0, -1)}-`,
      `g${publicId.slice(1)}`,
      `${publicId}0`,
    ]) {
      await expect(Promise.resolve(reserve({ handle }))).rejects.toThrow('CHECK');
    }
    await reserve({ handle: publicId });
    await expect(
      Promise.resolve(reserve({ handle: publicId, ownerId: 'owner-b' })),
    ).rejects.toThrow('UNIQUE');
    const repository = new PublicationsRepository(database);
    expect(await repository.recordStatus({ ownerId: 'owner-a', readableId })).toEqual({
      publicId,
      publishedAt: null,
    });
    expect(await repository.recordStatus({ ownerId: 'owner-b', readableId })).toEqual({
      publicId: null,
      publishedAt: null,
    });
  });
});
