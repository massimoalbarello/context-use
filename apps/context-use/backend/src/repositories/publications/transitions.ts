import type { TypedTransactionSQL } from '@ilbertt/bun-sqlgen';
import type {
  PublicationBlocker,
  PublicationPreparation,
  PublicationStatus,
} from '#backend/models/publications/model.ts';
import type { Queries } from '#backend/queries.gen.ts';
import { withdrawalBlockers } from './dependencies.ts';
import { createPublicId } from './public-id.ts';
import type { PublicationRequest, PublicationTransitionResult } from './repository.ts';

type Transaction = TypedTransactionSQL<Queries>;

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

function status(target: PublicationStatus): PublicationStatus {
  return { publicId: target.publicId, publishedAt: target.publishedAt };
}

async function evaluate({ db, input }: { db: Transaction; input: PublicationRequest }) {
  const target =
    input.resourceType === 'asset'
      ? await assetTarget({ db, ...input })
      : await entityTarget({ db, ...input });
  if (!target || target.archivedAt) {
    return null;
  }

  const image =
    input.action === 'publish' && 'imageReadableId' in target && target.imageReadableId
      ? await assetTarget({ db, ownerId: input.ownerId, readableId: target.imageReadableId })
      : null;
  const blockers: PublicationBlocker[] =
    input.action === 'unpublish' ? await withdrawalBlockers({ db, ...input, id: target.id }) : [];
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
    includedImage: image
      ? {
          resource: { resourceType: 'asset', readableId: image.readableId, name: image.name },
          publication: status(image),
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
  if ((target.publishedAt !== null) === (input.action === 'publish')) {
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
