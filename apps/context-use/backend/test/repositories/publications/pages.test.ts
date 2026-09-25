import { expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { Queries } from '#backend/queries.gen.ts';
import {
  type PublicationRequest,
  PublicationsRepository,
  type PublicationTransitionResult,
} from '#backend/repositories/publications/repository.ts';
import { executePublication } from '#backend/repositories/publications/transitions.ts';
import { HASH, LATER, NOW, withDatabase } from './database.ts';

const OWNER = 'owner-a';
const FIRST_REVISION = 'owner-a-page-primary-revision';
const THIRD_REVISION_NUMBER = 3;

function publish({
  revisionNumber = 1,
  readableId = 'primary',
}: {
  revisionNumber?: number;
  readableId?: string;
} = {}): PublicationRequest {
  return { ownerId: OWNER, resourceType: 'page', readableId, action: 'publish', revisionNumber };
}

function unpublish(readableId = 'primary'): PublicationRequest {
  return { ownerId: OWNER, resourceType: 'page', readableId, action: 'unpublish' };
}

async function execution({
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
  return { ...input, expectedState: prepared.expectedState, publishedAt: NOW };
}

async function change({
  repository,
  input,
}: {
  repository: PublicationsRepository;
  input: PublicationRequest;
}) {
  return repository.execute(await execution({ repository, input }));
}

async function addRevision({
  db,
  revisionNumber = 2,
  readableId = 'primary',
}: {
  db: SQL;
  revisionNumber?: number;
  readableId?: string;
}) {
  const pageId = `${OWNER}-page-${readableId}`;
  const id = `${pageId}-revision-${revisionNumber}`;
  await db.begin(async (tx) => {
    await tx`
      insert into "knowledge_page_revision"
        ("id", "page_id", "owner_id", "revision_number", "title", "excerpt", "storage_key",
         "size_bytes", "content_hash", "author_kind", "author_name", "created_at")
      values (${id}, ${pageId}, ${OWNER}, ${revisionNumber}, 'Private draft title', '',
        ${id}, 1, ${HASH}, 'owner', 'Owner', ${LATER})
    `;
    await tx`update "knowledge_page" set "current_revision_id" = ${id}, "updated_at" = ${LATER} where "id" = ${pageId}`;
  });
  return id;
}

async function pageReference({
  db,
  sourceRevisionId,
  targetPageId,
}: {
  db: SQL;
  sourceRevisionId: string;
  targetPageId: string;
}) {
  await db`
    insert into "knowledge_page_reference" ("owner_id", "source_revision_id", "target_page_id", "target_fragment")
    values (${OWNER}, ${sourceRevisionId}, ${targetPageId}, ''),
      (${OWNER}, ${sourceRevisionId}, ${targetPageId}, 'heading')
  `;
}

async function allReferences(db: SQL) {
  await pageReference({
    db,
    sourceRevisionId: FIRST_REVISION,
    targetPageId: 'owner-a-page-secondary',
  });
  await db`
    insert into "knowledge_page_entity_mention" ("owner_id", "source_revision_id", "target_entity_id")
    values (${OWNER}, ${FIRST_REVISION}, 'owner-a-entity-secondary')
  `;
  await db`
    insert into "knowledge_page_asset_usage" ("owner_id", "source_revision_id", "target_asset_id", "presentation")
    values (${OWNER}, ${FIRST_REVISION}, 'owner-a-asset-secondary', 'embed'),
      (${OWNER}, ${FIRST_REVISION}, 'owner-a-asset-secondary', 'attachment')
  `;
}

async function publishDependencies({
  repository,
  ownerId = OWNER,
}: {
  repository: PublicationsRepository;
  ownerId?: string;
}) {
  await change({
    repository,
    input: { ...publish({ revisionNumber: 1, readableId: 'secondary' }), ownerId },
  });
  for (const resourceType of ['entity', 'asset'] as const) {
    await change({
      repository,
      input: { ownerId, resourceType, readableId: 'secondary', action: 'publish' },
    });
  }
}

test('publishing selects the reviewed saved revision despite later private edits and keeps a stable public ID', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    expect(await repository.prepare(publish())).toMatchObject({
      resource: { resourceType: 'page', readableId: 'primary', name: 'Page' },
      publication: { publicId: null, publishedAt: null },
      pageRevision: { revisionNumber: 1, publishedRevisionNumber: null },
      blockers: [],
    });
    const first = await execution({ repository, input: publish() });
    await addRevision({ db });
    expect((await repository.prepare(publish()))?.expectedState).toBe(first.expectedState);
    expect(await repository.execute(first)).toMatchObject({ state: 'changed' });
    const firstStatus = await repository.pageStatus(publish());
    if (!firstStatus) {
      throw new Error('Expected page status');
    }
    expect(firstStatus).toEqual({
      publicId: expect.stringContaining('page_'),
      publishedAt: NOW,
      publishedRevisionNumber: 1,
    });
    expect(await repository.execute(first)).toEqual({ state: 'state_changed' });
    expect(await change({ repository, input: publish() })).toMatchObject({ state: 'unchanged' });
    expect(await repository.prepare(publish({ revisionNumber: 2 }))).toMatchObject({
      pageRevision: { revisionNumber: 2, publishedRevisionNumber: 1 },
    });
    const replacement = await execution({ repository, input: publish({ revisionNumber: 2 }) });
    expect(await repository.execute({ ...replacement, publishedAt: LATER })).toMatchObject({
      state: 'changed',
    });
    expect(await repository.pageStatus(publish())).toEqual({
      ...firstStatus,
      publishedAt: LATER,
      publishedRevisionNumber: 2,
    });
    expect(await change({ repository, input: unpublish() })).toMatchObject({ state: 'changed' });
    expect(await repository.pageStatus(publish())).toEqual({
      ...firstStatus,
      publishedAt: null,
      publishedRevisionNumber: null,
    });
    expect(await change({ repository, input: unpublish() })).toMatchObject({ state: 'unchanged' });
    expect(await change({ repository, input: publish() })).toMatchObject({ state: 'changed' });
    expect(await repository.pageStatus(publish())).toEqual(firstStatus);
    expect(await db`select "id" from "knowledge_page" where "public_id" is not null`).toHaveLength(
      1,
    );
  });
});

test('page approval is bound to owner, action, saved revision, public metadata and previous publication', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    await addRevision({ db });
    const first = await execution({ repository, input: publish() });
    for (const altered of [
      { ...first, ownerId: 'owner-b' },
      { ...first, action: 'unpublish' as const },
      { ...first, readableId: 'secondary' },
      { ...first, revisionNumber: 2 },
    ]) {
      expect(await repository.execute(altered)).toEqual({ state: 'state_changed' });
    }
    for (const input of [
      publish({ revisionNumber: 0 }),
      publish({ revisionNumber: THIRD_REVISION_NUMBER }),
      publish({ revisionNumber: 1, readableId: 'missing' }),
      publish({ revisionNumber: 1, readableId: 'owner-a-page-primary' }),
    ]) {
      expect(await repository.prepare(input)).toBeNull();
      expect(await repository.execute({ ...first, ...input })).toEqual({ state: 'not_found' });
    }
    await db`update "knowledge_page_revision" set "title" = 'Changed public metadata' where "id" = ${FIRST_REVISION}`;
    expect(await repository.execute(first)).toEqual({ state: 'state_changed' });
    const renamed = await execution({ repository, input: publish() });
    await db`update "knowledge_page_revision" set "content_hash" = ${'b'.repeat(HASH.length)} where "id" = ${FIRST_REVISION}`;
    expect(await repository.execute(renamed)).toEqual({ state: 'state_changed' });
    const beforePublication = await execution({ repository, input: publish() });
    await change({ repository, input: publish({ revisionNumber: 2 }) });
    expect(await repository.execute(beforePublication)).toEqual({ state: 'state_changed' });
    expect(
      (await repository.pageStatus({ ownerId: 'owner-b', readableId: 'primary' }))?.publishedAt,
    ).toBeNull();
    await db`update "knowledge_page" set "archived_at" = ${NOW} where "id" = 'owner-a-page-primary'`;
    expect(await repository.prepare(publish())).toBeNull();
    expect(await repository.execute(first)).toEqual({ state: 'not_found' });
  });
});

test('every managed reference must already be public without recursively publishing targets', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    await allReferences(db);
    await publishDependencies({ repository, ownerId: 'owner-b' });
    expect((await repository.prepare(publish()))?.blockers).toEqual([
      {
        reason: 'reference_not_public',
        resource: { resourceType: 'asset', readableId: 'secondary', name: 'Asset' },
      },
      {
        reason: 'reference_not_public',
        resource: { resourceType: 'entity', readableId: 'secondary', name: 'Entity' },
      },
      {
        reason: 'reference_not_public',
        resource: { resourceType: 'page', readableId: 'secondary', name: 'Page' },
      },
    ]);
    expect(await change({ repository, input: publish() })).toMatchObject({ state: 'blocked' });
    expect(
      (await repository.assetStatus({ ownerId: OWNER, readableId: 'secondary' }))?.publishedAt,
    ).toBeNull();
    expect(
      (await repository.entityStatus({ ownerId: OWNER, readableId: 'secondary' }))?.publishedAt,
    ).toBeNull();
    expect((await repository.pageStatus(publish()))?.publishedAt).toBeNull();
    await publishDependencies({ repository });
    const approved = await execution({ repository, input: publish() });
    await addRevision({ db, revisionNumber: 2, readableId: 'secondary' });
    await change({ repository, input: publish({ revisionNumber: 2, readableId: 'secondary' }) });
    await db`update "entity" set "name" = 'Live public entity' where "id" = 'owner-a-entity-secondary'`;
    await db`update "asset" set "name" = 'Live public asset' where "id" = 'owner-a-asset-secondary'`;
    expect((await repository.prepare(publish()))?.expectedState).toBe(approved.expectedState);
    expect(await repository.execute(approved)).toMatchObject({ state: 'changed' });
    expect((await repository.pageStatus(publish()))?.publishedRevisionNumber).toBe(1);
  });
});

test('publication rechecks dependency visibility and preserves the preceding public revision on failure', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    await allReferences(db);
    await publishDependencies({ repository });
    await addRevision({ db });
    await change({ repository, input: publish({ revisionNumber: 2 }) });
    const approved = await execution({ repository, input: publish() });
    await change({
      repository,
      input: {
        ownerId: OWNER,
        resourceType: 'asset',
        readableId: 'secondary',
        action: 'unpublish',
      },
    });
    expect(await repository.execute(approved)).toMatchObject({
      state: 'blocked',
      blockers: [{ reason: 'reference_not_public', resource: { resourceType: 'asset' } }],
    });
    expect((await repository.pageStatus(publish()))?.publishedRevisionNumber).toBe(2);
    await change({
      repository,
      input: {
        ownerId: OWNER,
        resourceType: 'asset',
        readableId: 'secondary',
        action: 'publish',
      },
    });
    await db`update "entity" set "archived_at" = ${NOW} where "id" = 'owner-a-entity-secondary'`;
    await db`update "asset" set "archived_at" = ${NOW} where "id" = 'owner-a-asset-secondary'`;
    await db`update "knowledge_page" set "archived_at" = ${NOW} where "id" = 'owner-a-page-secondary'`;
    const result = await repository.execute(approved);
    expect(result).toMatchObject({ state: 'blocked' });
    if (result.state === 'blocked') {
      expect(result.blockers.map(({ reason }) => reason)).toEqual([
        'reference_unavailable',
        'reference_unavailable',
        'reference_unavailable',
      ]);
    }
    expect((await repository.pageStatus(publish()))?.publishedRevisionNumber).toBe(2);
  });
});

test('private and unavailable record references block publication', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    await db`
      insert into "record" ("owner_id", "readable_id", "provider", "kind", "source_id", "title",
        "storage_key", "content_hash", "size_bytes", "created_at", "updated_at")
      values (${OWNER}, 'sensitive-record', 'test', 'note', 'source', 'Sensitive record', 'record', ${HASH}, 1, ${NOW}, ${NOW})
    `;
    await db`
      insert into "knowledge_page_record_reference" ("owner_id", "source_revision_id", "target_record_readable_id")
      values (${OWNER}, ${FIRST_REVISION}, 'sensitive-record')
    `;
    const blocked: PublicationTransitionResult = {
      state: 'blocked',
      blockers: [
        {
          reason: 'reference_not_public',
          resource: {
            resourceType: 'record',
            readableId: 'sensitive-record',
            name: 'Sensitive record',
          },
        },
      ],
    };
    expect(await change({ repository, input: publish() })).toEqual(blocked);
    await db`update "record" set "deleted_at" = ${LATER}, "source_updated_at" = ${LATER}, "storage_key" = null,
      "content_hash" = null, "size_bytes" = null where "owner_id" = ${OWNER}`;
    expect(await change({ repository, input: publish() })).toMatchObject({
      state: 'blocked',
      blockers: [{ reason: 'reference_unavailable' }],
    });
    expect((await repository.pageStatus(publish()))?.publishedAt).toBeNull();
    await addRevision({ db });
    expect(await change({ repository, input: publish({ revisionNumber: 2 }) })).toMatchObject({
      state: 'changed',
    });
  });
});

test('page withdrawal checks only incoming public revisions and keeps their published titles', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    await change({ repository, input: publish() });
    const approved = await execution({ repository, input: unpublish() });
    await pageReference({
      db,
      sourceRevisionId: 'owner-a-page-secondary-revision',
      targetPageId: 'owner-a-page-primary',
    });
    expect((await repository.prepare(unpublish()))?.blockers).toEqual([]);
    await change({ repository, input: publish({ revisionNumber: 1, readableId: 'secondary' }) });
    await addRevision({ db, revisionNumber: 2, readableId: 'secondary' });
    expect(await repository.execute(approved)).toEqual({
      state: 'blocked',
      blockers: [
        {
          reason: 'public_page_reference',
          resource: { resourceType: 'page', readableId: 'secondary', name: 'Page' },
        },
      ],
    });
    expect((await repository.pageStatus(publish()))?.publishedRevisionNumber).toBe(1);
    await change({ repository, input: publish({ revisionNumber: 2, readableId: 'secondary' }) });
    const privateRevision = await addRevision({
      db,
      revisionNumber: THIRD_REVISION_NUMBER,
      readableId: 'secondary',
    });
    await pageReference({
      db,
      sourceRevisionId: privateRevision,
      targetPageId: 'owner-a-page-primary',
    });
    await addRevision({ db });
    expect((await repository.prepare(unpublish()))?.expectedState).toBe(approved.expectedState);
    expect(await repository.execute(approved)).toMatchObject({ state: 'changed' });
    expect((await repository.pageStatus(publish()))?.publishedRevisionNumber).toBeNull();
  });
});

test('self references require an already public target but do not prevent withdrawal', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    await pageReference({
      db,
      sourceRevisionId: FIRST_REVISION,
      targetPageId: 'owner-a-page-primary',
    });
    expect(await change({ repository, input: publish() })).toMatchObject({
      state: 'blocked',
      blockers: [
        {
          reason: 'reference_not_public',
          resource: { resourceType: 'page', readableId: 'primary' },
        },
      ],
    });
    await addRevision({ db });
    await change({ repository, input: publish({ revisionNumber: 2 }) });
    expect(await change({ repository, input: publish() })).toMatchObject({ state: 'changed' });
    expect(await change({ repository, input: unpublish() })).toMatchObject({ state: 'changed' });
    expect((await repository.pageStatus(publish()))?.publishedRevisionNumber).toBeNull();
  });
});

test('page replacement rolls back with its caller transaction so approval consumption can be atomic', async () => {
  await withDatabase(async ({ database: db }) => {
    const repository = new PublicationsRepository(db);
    await change({ repository, input: publish() });
    const previous = await repository.pageStatus(publish());
    await addRevision({ db });
    const input = await execution({ repository, input: publish({ revisionNumber: 2 }) });
    await expect(
      withTypes<Queries>(db).begin('immediate', async (tx) => {
        expect(await executePublication({ db: tx, input })).toMatchObject({ state: 'changed' });
        throw new Error('approval consumption failed');
      }),
    ).rejects.toThrow('approval consumption failed');
    expect(await repository.pageStatus(publish())).toEqual(previous);
    expect(await repository.execute(input)).toMatchObject({ state: 'changed' });
  });
});
