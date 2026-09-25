import type { TypedTransactionSQL } from '@ilbertt/bun-sqlgen';
import type {
  PublicationBlocker,
  PublicationPreparation,
  PublicationStatus,
} from '#backend/models/publications/model.ts';
import type { Queries } from '#backend/queries.gen.ts';
import { entityTypeFrom } from '#backend/views/entities/entity-view.ts';
import {
  pagePublicationBlockers,
  recordPublicationBlockers,
  withdrawalBlockers,
} from './dependencies.ts';
import { createPublicId } from './public-id.ts';
import type { PublicationRequest, PublicationTransitionResult } from './repository.ts';

type Transaction = TypedTransactionSQL<Queries>;

async function pageTarget({
  db,
  input,
}: {
  db: Transaction;
  input: Extract<PublicationRequest, { resourceType: 'page' }>;
}) {
  const revisionNumber = input.action === 'publish' ? input.revisionNumber : null;
  const rows = await db.FindPagePublicationTarget`
    /* @notNull id readableId name */
    /* @type name string */
    select page."id", page."readable_id" as "readableId", page."archived_at" as "archivedAt",
      coalesce(revision."title", page."readable_id") as "name",
      revision."id" as "revisionId", revision."revision_number" as "revisionNumber",
      revision."excerpt", revision."temporal_coverage" as "temporalCoverage",
      revision."created_at" as "createdAt", revision."content_hash" as "contentHash",
      revision."size_bytes" as "sizeBytes", page."public_id" as "publicId",
      page."published_at" as "publishedAt", page."published_revision_id" as "publishedRevisionId",
      published_revision."revision_number" as "publishedRevisionNumber"
    from "knowledge_page" page
    left join "knowledge_page_revision" published_revision
      on published_revision."id" = page."published_revision_id"
      and published_revision."page_id" = page."id" and published_revision."owner_id" = page."owner_id"
    left join "knowledge_page_revision" revision
      on revision."page_id" = page."id" and revision."owner_id" = page."owner_id"
      and ((${input.action} = 'publish' and revision."revision_number" = ${revisionNumber})
        or (${input.action} = 'unpublish' and revision."id" = page."published_revision_id"))
    where page."owner_id" = ${input.ownerId} and page."readable_id" = ${input.readableId}
      and (${input.action} = 'unpublish' or revision."id" is not null)
  `;
  const row = rows[0];
  return row
    ? {
        ...row,
        revisionNumber: row.revisionNumber === null ? null : Number(row.revisionNumber),
        publishedRevisionNumber:
          row.publishedRevisionNumber === null ? null : Number(row.publishedRevisionNumber),
      }
    : null;
}

async function assetTarget({
  db,
  ownerId,
  readableId,
}: {
  db: Transaction;
  ownerId: string;
  readableId: string;
}) {
  const rows = await db.FindAssetPublicationTarget`
    /* @notNull id readableId name mediaType sizeBytes contentHash */
    select asset."id", asset."readable_id" as "readableId", asset."name",
      asset."media_type" as "mediaType", asset."extension", asset."size_bytes" as "sizeBytes",
      asset."content_hash" as "contentHash", asset."archived_at" as "archivedAt",
      asset."public_id" as "publicId", asset."published_at" as "publishedAt"
    from "asset" asset
    where asset."owner_id" = ${ownerId} and asset."readable_id" = ${readableId}
  `;
  return rows[0] ?? null;
}

async function entityTarget({
  db,
  ownerId,
  readableId,
}: {
  db: Transaction;
  ownerId: string;
  readableId: string;
}) {
  const rows = await db.FindEntityPublicationTarget`
    /* @notNull id readableId name description */
    select entity."id", entity."readable_id" as "readableId", entity."name", entity."description",
      entity."entity_type" as "entityType", entity."image_asset_id" as "imageAssetId",
      image."readable_id" as "imageReadableId", entity."archived_at" as "archivedAt",
      entity."public_id" as "publicId", entity."published_at" as "publishedAt"
    from "entity" entity
    left join "asset" image
      on image."id" = entity."image_asset_id" and image."owner_id" = entity."owner_id"
    where entity."owner_id" = ${ownerId} and entity."readable_id" = ${readableId}
  `;
  return rows[0] ?? null;
}

async function recordTarget({
  db,
  ownerId,
  readableId,
}: {
  db: Transaction;
  ownerId: string;
  readableId: string;
}) {
  const rows = await db.FindRecordPublicationTarget`
    /* @notNull id readableId name contentHash sizeBytes */
    select "readable_id" as "id", "readable_id" as "readableId", "title" as "name",
      "content_hash" as "contentHash", "size_bytes" as "sizeBytes", "deleted_at" as "archivedAt",
      "public_id" as "publicId", "published_at" as "publishedAt"
    from "record" where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
      and "deleted_at" is null
  `;
  return rows[0] ?? null;
}

function status(target: PublicationStatus): PublicationStatus {
  return { publicId: target.publicId, publishedAt: target.publishedAt };
}

function publicationTarget({ db, input }: { db: Transaction; input: PublicationRequest }) {
  switch (input.resourceType) {
    case 'page':
      return pageTarget({ db, input });
    case 'asset':
      return assetTarget({ db, ...input });
    case 'entity':
      return entityTarget({ db, ...input });
    case 'record':
      return recordTarget({ db, ...input });
  }
}

async function evaluate({ db, input }: { db: Transaction; input: PublicationRequest }) {
  const target = await publicationTarget({ db, input });
  if (!target || target.archivedAt) {
    return null;
  }

  const image =
    input.action === 'publish' && 'imageReadableId' in target && target.imageReadableId
      ? await assetTarget({ db, ownerId: input.ownerId, readableId: target.imageReadableId })
      : null;
  const blockers: PublicationBlocker[] =
    input.action === 'unpublish' ? await withdrawalBlockers({ db, ...input, id: target.id }) : [];
  if (input.action === 'publish' && 'revisionId' in target && target.revisionId) {
    blockers.push(
      ...(await pagePublicationBlockers({
        db,
        ownerId: input.ownerId,
        revisionId: target.revisionId,
      })),
    );
  }
  if (input.action === 'publish' && input.resourceType === 'record') {
    blockers.push(...(await recordPublicationBlockers({ db, ...input })));
  }
  if (image?.archivedAt) {
    blockers.push({
      reason: 'image_unavailable',
      resource: { resourceType: 'asset', readableId: image.readableId, name: image.name },
    });
  }
  // Only a private portrait is included in this approval's newly published data.
  // Existing public dependency metadata is live and does not invalidate approval.
  const expectedState = new Bun.CryptoHasher('sha256')
    .update(
      JSON.stringify({
        ownerId: input.ownerId,
        resourceType: input.resourceType,
        action: input.action,
        target,
        image: image?.publishedAt ? { id: image.id } : image,
      }),
    )
    .digest('hex');
  const preparation: PublicationPreparation = {
    resource: {
      resourceType: input.resourceType,
      readableId: target.readableId,
      name: target.name,
    },
    publication: status(target),
    entityIdentity:
      'entityType' in target
        ? { description: target.description, entityType: entityTypeFrom(target.entityType) }
        : null,
    includedImage: image
      ? {
          resource: { resourceType: 'asset', readableId: image.readableId, name: image.name },
          publication: status(image),
        }
      : null,
    pageRevision:
      'revisionNumber' in target
        ? {
            revisionNumber: target.revisionNumber,
            publishedRevisionNumber: target.publishedRevisionNumber,
          }
        : null,
    blockers,
    expectedState,
  };
  return { target, image, preparation };
}

export async function preparePublication({
  db,
  input,
}: {
  db: Transaction;
  input: PublicationRequest;
}): Promise<PublicationPreparation | null> {
  return (await evaluate({ db, input }))?.preparation ?? null;
}

function isUnchanged({
  target,
  action,
}: {
  target: NonNullable<Awaited<ReturnType<typeof evaluate>>>['target'];
  action: PublicationRequest['action'];
}) {
  if (action === 'unpublish') {
    return target.publishedAt === null;
  }
  return (
    target.publishedAt !== null &&
    (!('revisionId' in target) || target.revisionId === target.publishedRevisionId)
  );
}

export async function executePublication({
  db,
  input,
}: {
  db: Transaction;
  input: PublicationRequest & { expectedState: string; publishedAt: string };
}): Promise<PublicationTransitionResult> {
  const evaluation = await evaluate({ db, input });
  if (!evaluation) {
    return { state: 'not_found' };
  }
  const { target, image, preparation } = evaluation;
  if (preparation.expectedState !== input.expectedState) {
    return { state: 'state_changed' };
  }
  if (preparation.blockers.length) {
    return { state: 'blocked', blockers: preparation.blockers };
  }
  if (isUnchanged({ target, action: input.action })) {
    return { state: 'unchanged', publication: status(target) };
  }

  const publication = {
    publicId: target.publicId ?? createPublicId(input.resourceType),
    publishedAt: input.action === 'publish' ? input.publishedAt : null,
  };
  if (input.action === 'publish' && image && !image.publishedAt) {
    await setAssetPublication({
      db,
      ownerId: input.ownerId,
      id: image.id,
      publicId: image.publicId ?? createPublicId('asset'),
      publishedAt: input.publishedAt,
    });
  }
  if (input.resourceType === 'asset') {
    await setAssetPublication({ db, ownerId: input.ownerId, id: target.id, ...publication });
  } else if (input.resourceType === 'record') {
    await db.SetRecordPublication`
      update "record" set "public_id" = ${publication.publicId}, "published_at" = ${publication.publishedAt}
      where "readable_id" = ${input.readableId} and "owner_id" = ${input.ownerId}
    `;
  } else if ('revisionId' in target) {
    const revisionId = input.action === 'publish' ? target.revisionId : null;
    await db.SetPagePublication`
      update "knowledge_page" set "public_id" = ${publication.publicId},
        "published_at" = ${publication.publishedAt}, "published_revision_id" = ${revisionId}
      where "id" = ${target.id} and "owner_id" = ${input.ownerId}
    `;
  } else {
    await db.SetEntityPublication`
      update "entity" set "public_id" = ${publication.publicId}, "published_at" = ${publication.publishedAt}
      where "id" = ${target.id} and "owner_id" = ${input.ownerId}
    `;
  }
  return { state: 'changed', publication };
}

async function setAssetPublication({
  db,
  ...input
}: {
  db: Transaction;
  ownerId: string;
  id: string;
  publicId: string;
  publishedAt: string | null;
}) {
  await db.SetAssetPublication`
    update "asset" set "public_id" = ${input.publicId}, "published_at" = ${input.publishedAt}
    where "id" = ${input.id} and "owner_id" = ${input.ownerId}
  `;
}
