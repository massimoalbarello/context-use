import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#backend/db/client.ts';
import {
  type PublicationRequest,
  PublicationsRepository,
} from '#backend/repositories/publications/repository.ts';
import { HASH, LATER, NOW, withDatabase } from './database.ts';

function request(resourceType: 'asset' | 'entity'): PublicationRequest {
  return { ownerId: 'owner-a', resourceType, readableId: 'primary', action: 'publish' };
}

const PRIVATE_DRAFT_REVISION = 3;

function withdrawal(resourceType: 'asset' | 'entity'): PublicationRequest {
  return { ...request(resourceType), action: 'unpublish' };
}

async function change({
  repository,
  input,
}: {
  repository: PublicationsRepository;
  input: PublicationRequest;
}) {
  const prepared = await repository.prepare(input);
  if (!prepared) {
    throw new Error('Expected publication target');
  }
  return repository.execute({ ...input, expectedState: prepared.expectedState, publishedAt: NOW });
}

async function assignPortrait(db: SQL) {
  await db`
    update "entity" set "image_asset_id" = 'owner-a-asset-primary'
    where "owner_id" = 'owner-a' and "id" = 'owner-a-entity-primary'
  `;
}

async function pageRevision({ db, revisionNumber }: { db: SQL; revisionNumber: number }) {
  const id = `owner-a-page-revision-${revisionNumber}`;
  await db.begin(async (tx) => {
    await tx`
      insert into "knowledge_page_revision"
        ("id", "page_id", "owner_id", "revision_number", "title", "excerpt", "storage_key",
         "size_bytes", "content_hash", "author_kind", "author_name", "created_at")
      values (${id}, 'owner-a-page-primary', 'owner-a', ${revisionNumber}, 'Private draft title', '',
        ${id}, 1, ${HASH}, 'owner', 'Owner', ${LATER})
    `;
    await tx`update "knowledge_page" set "current_revision_id" = ${id} where "id" = 'owner-a-page-primary'`;
  });
  return id;
}

async function pageReference({
  db,
  resourceType,
  revisionId,
}: {
  db: SQL;
  resourceType: 'asset' | 'entity';
  revisionId: string;
}) {
  if (resourceType === 'asset') {
    await db`
      insert into "knowledge_page_asset_usage"
        ("owner_id", "source_revision_id", "target_asset_id", "presentation")
      values ('owner-a', ${revisionId}, 'owner-a-asset-primary', 'attachment'),
        ('owner-a', ${revisionId}, 'owner-a-asset-primary', 'embed')
    `;
  } else {
    await db`
      insert into "knowledge_page_entity_mention" ("owner_id", "source_revision_id", "target_entity_id")
      values ('owner-a', ${revisionId}, 'owner-a-entity-primary')
    `;
  }
}

for (const resourceType of ['asset', 'entity'] as const) {
  test(`${resourceType} transitions retain public IDs and reject reused or changed approval state`, async () => {
    await withDatabase(async ({ database: db }) => {
      const repository = new PublicationsRepository(db);
      const input = request(resourceType);
      const prepared = await repository.prepare(input);
      expect(prepared?.publication).toEqual({ publicId: null, publishedAt: null });
      expect(prepared?.blockers).toEqual([]);
      const execution = {
        ...input,
        expectedState: prepared?.expectedState ?? '',
        publishedAt: NOW,
      };
      const published = await repository.execute(execution);
      expect(published).toMatchObject({
        state: 'changed',
        publication: { publicId: expect.stringContaining(`${resourceType}_`), publishedAt: NOW },
      });
      expect(await repository.execute(execution)).toEqual({ state: 'state_changed' });
      expect(await change({ repository, input: input })).toMatchObject({ state: 'unchanged' });
      const status = (await repository.prepare(input))?.publication;
      expect(await change({ repository, input: withdrawal(resourceType) })).toEqual({
        state: 'changed',
        publication: { publicId: status?.publicId ?? null, publishedAt: null },
      });
      expect(await change({ repository, input: withdrawal(resourceType) })).toMatchObject({
        state: 'unchanged',
      });
      expect(await change({ repository, input: input })).toEqual(published);
      expect(await repository.prepare({ ...input, ownerId: 'owner-b' })).toMatchObject({
        publication: { publicId: null, publishedAt: null },
      });
    });
  });

  test(`${resourceType} preparation is bound to owner, action, identity and prior publication`, async () => {
    await withDatabase(async ({ database: db }) => {
      const repository = new PublicationsRepository(db);
      const input = request(resourceType);
      const prepared = await repository.prepare(input);
      const execution = {
        ...input,
        expectedState: prepared?.expectedState ?? '',
        publishedAt: NOW,
      };
      for (const change of [
        { ownerId: 'owner-b' },
        { action: 'unpublish' as const },
        { readableId: 'secondary' },
      ]) {
        expect(await repository.execute({ ...execution, ...change })).toEqual({
          state: 'state_changed',
        });
      }
      for (const readableId of [
        'missing',
        `owner-a-${resourceType}-primary`,
        `${resourceType}_unknown`,
      ]) {
        expect(await repository.prepare({ ...input, readableId })).toBeNull();
        expect(await repository.execute({ ...execution, readableId })).toEqual({
          state: 'not_found',
        });
      }
      await db.unsafe(
        `update "${resourceType}" set "name" = 'Changed identity' where "owner_id" = 'owner-a' and "readable_id" = 'primary'`,
      );
      expect(await repository.execute(execution)).toEqual({ state: 'state_changed' });
      expect(await repository.prepare(input)).toMatchObject({ publication: { publishedAt: null } });
      await db.unsafe(
        `update "${resourceType}" set "archived_at" = $1 where "owner_id" = 'owner-a' and "readable_id" = 'primary'`,
        [NOW],
      );
      expect(await repository.prepare(input)).toBeNull();
      expect(await repository.execute(execution)).toEqual({ state: 'not_found' });
    });
  });

  test(`${resourceType} withdrawal uses public source revisions, ignores private drafts and rechecks new inbound references`, async () => {
    await withDatabase(async ({ database: db }) => {
      const repository = new PublicationsRepository(db);
      await change({ repository, input: request(resourceType) });
      const input = withdrawal(resourceType);
      const prepared = await repository.prepare(input);
      await pageReference({ db, resourceType, revisionId: 'owner-a-page-primary-revision' });
      await db`
        update "knowledge_page" set "public_id" = 'page_referring',
          "published_revision_id" = 'owner-a-page-primary-revision', "published_at" = ${NOW}
        where "owner_id" = 'owner-a' and "id" = 'owner-a-page-primary'
      `;
      const withoutReference = await pageRevision({ db, revisionNumber: 2 });
      const blocker = {
        reason: 'public_page_reference',
        resource: { resourceType: 'page', readableId: 'primary', name: 'Page' },
      } as const;
      expect((await repository.prepare(input))?.blockers).toEqual([blocker]);
      expect(
        await repository.execute({
          ...input,
          expectedState: prepared?.expectedState ?? '',
          publishedAt: LATER,
        }),
      ).toEqual({
        state: 'blocked',
        blockers: [blocker],
      });
      expect((await repository.prepare(input))?.publication.publishedAt).toBe(NOW);
      await db`update "knowledge_page" set "published_revision_id" = ${withoutReference} where "owner_id" = 'owner-a' and "id" = 'owner-a-page-primary'`;
      const privateRevision = await pageRevision({ db, revisionNumber: PRIVATE_DRAFT_REVISION });
      await pageReference({ db, resourceType, revisionId: privateRevision });
      expect((await repository.prepare(input))?.blockers).toEqual([]);
      expect(
        await repository.execute({
          ...input,
          expectedState: prepared?.expectedState ?? '',
          publishedAt: LATER,
        }),
      ).toMatchObject({ state: 'changed' });
    });
  });
}

test('entity publication explicitly includes its current portrait and does not recursively publish other resources', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    await assignPortrait(db);
    const input = request('entity');
    expect(await repository.prepare(input)).toMatchObject({
      entityIdentity: { description: 'Test entity', entityType: null },
      includedImage: {
        resource: { resourceType: 'asset', readableId: 'primary', name: 'Asset' },
        publication: { publicId: null, publishedAt: null },
      },
    });
    expect(await change({ repository, input: input })).toMatchObject({ state: 'changed' });
    const portrait = await repository.assetStatus(request('asset'));
    expect(portrait?.publishedAt).toBe(NOW);
    expect(await repository.assetStatus({ ownerId: 'owner-a', readableId: 'secondary' })).toEqual({
      publicId: null,
      publishedAt: null,
    });
    expect(await repository.pageStatus({ ownerId: 'owner-a', readableId: 'primary' })).toEqual({
      publicId: null,
      publishedAt: null,
      publishedRevisionNumber: null,
    });
    const withdrawAsset = withdrawal('asset');
    expect(await change({ repository, input: withdrawAsset })).toMatchObject({
      state: 'blocked',
      blockers: [
        {
          reason: 'public_entity_image',
          resource: { resourceType: 'entity', readableId: 'primary', name: 'Entity' },
        },
      ],
    });
    await change({ repository, input: withdrawal('entity') });
    expect(await repository.assetStatus(request('asset'))).toEqual(portrait);
    expect(await change({ repository, input: withdrawAsset })).toMatchObject({ state: 'changed' });
    expect(await change({ repository, input: input })).toMatchObject({ state: 'changed' });
    expect(await repository.assetStatus(request('asset'))).toEqual(portrait);
  });
});

test('entity approval detects portrait replacement, private portrait edits and archival', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    await assignPortrait(db);
    const input = request('entity');
    const preparation = await repository.prepare(input);
    const execution = {
      ...input,
      expectedState: preparation?.expectedState ?? '',
      publishedAt: NOW,
    };
    await db`update "entity" set "image_asset_id" = 'owner-a-asset-secondary' where "id" = 'owner-a-entity-primary'`;
    expect(await repository.execute(execution)).toEqual({ state: 'state_changed' });
    await assignPortrait(db);
    await db`update "asset" set "name" = 'New portrait name' where "id" = 'owner-a-asset-primary'`;
    expect(await repository.execute(execution)).toEqual({ state: 'state_changed' });
    await db`update "asset" set "archived_at" = ${NOW} where "id" = 'owner-a-asset-primary'`;
    expect(await change({ repository, input: input })).toMatchObject({
      state: 'blocked',
      blockers: [{ reason: 'image_unavailable' }],
    });
    expect(await repository.entityStatus(input)).toEqual({ publicId: null, publishedAt: null });
  });
});

test('already public portrait identity stays live without invalidating entity approval or changing its publication', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    await assignPortrait(db);
    await change({ repository, input: request('asset') });
    const portrait = await repository.assetStatus(request('asset'));
    const input = request('entity');
    const prepared = await repository.prepare(input);
    await db`update "asset" set "name" = 'Live public name' where "id" = 'owner-a-asset-primary'`;
    expect(
      await repository.execute({
        ...input,
        expectedState: prepared?.expectedState ?? '',
        publishedAt: LATER,
      }),
    ).toMatchObject({ state: 'changed' });
    expect(await repository.assetStatus(request('asset'))).toEqual(portrait);
    await db`update "entity" set "name" = 'Live entity name', "description" = 'Live description' where "id" = 'owner-a-entity-primary'`;
    expect(await repository.prepare(input)).toMatchObject({
      resource: { name: 'Live entity name' },
      entityIdentity: { description: 'Live description', entityType: null },
      publication: { publishedAt: LATER },
      includedImage: { resource: { name: 'Live public name' } },
    });
  });
});

test('a withdrawn portrait cannot be newly published under approval that only included an already public portrait', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    await assignPortrait(db);
    await change({ repository, input: request('asset') });
    const input = request('entity');
    const prepared = await repository.prepare(input);
    await change({ repository, input: withdrawal('asset') });
    expect(
      await repository.execute({
        ...input,
        expectedState: prepared?.expectedState ?? '',
        publishedAt: LATER,
      }),
    ).toEqual({ state: 'state_changed' });
    expect((await repository.assetStatus(request('asset')))?.publishedAt).toBeNull();
    expect((await repository.entityStatus(input))?.publishedAt).toBeNull();
  });
});

test('entity and portrait publication roll back together if the second write fails', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    await assignPortrait(db);
    await db.unsafe(`create trigger reject_entity_publication before update of "published_at" on "entity"
      begin select raise(abort, 'injected publication failure'); end`);
    await expect(change({ repository, input: request('entity') })).rejects.toThrow(
      'injected publication failure',
    );
    expect(await repository.entityStatus(request('entity'))).toEqual({
      publicId: null,
      publishedAt: null,
    });
    expect(await repository.assetStatus(request('asset'))).toEqual({
      publicId: null,
      publishedAt: null,
    });
  });
});

test('competing publications cannot both consume the same prepared prior state', async () => {
  await withDatabase(async ({ database: db, dataFolder }) => {
    const repository = new PublicationsRepository(db);
    const input = request('asset');
    const prepared = await repository.prepare(input);
    const execution = { ...input, expectedState: prepared?.expectedState ?? '', publishedAt: NOW };
    const competingDb = await createSqliteDatabase({ dataFolder });
    try {
      const competitor = new PublicationsRepository(competingDb);
      const outcomes = await Promise.allSettled([
        repository.execute(execution),
        competitor.execute(execution),
      ]);
      expect(
        outcomes.filter(
          (result) => result.status === 'fulfilled' && result.value.state === 'changed',
        ),
      ).toHaveLength(1);
      for (const result of outcomes) {
        if (result.status === 'rejected') {
          expect(result.reason.code).toBe('SQLITE_BUSY');
        } else {
          expect(['changed', 'state_changed']).toContain(result.value.state);
        }
      }
      expect(await competitor.execute(execution)).toEqual({ state: 'state_changed' });
      expect((await repository.assetStatus(input))?.publishedAt).toBe(NOW);
    } finally {
      await competingDb.close();
    }
  });
});
