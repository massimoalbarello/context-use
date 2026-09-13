import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type { Queries } from '#queries.gen.ts';

/** Called inside the entity mutation's transaction, before any background portrait analysis. */
export async function retireInvalidPortraitReference({
  db,
  ownerId,
  entityId,
}: {
  db: TypedSQL<Queries>;
  ownerId: string;
  entityId: string;
}) {
  const active = await db.ReadActivePortraitReference`
    /* @notNull faceId */
    select reference."face_id" as "faceId" from "entity_face_reference" reference
    join "entity" entity on entity."id" = reference."entity_id" and entity."owner_id" = reference."owner_id"
    join "asset_face" face on face."id" = reference."face_id" and face."owner_id" = reference."owner_id"
    join "asset" asset on asset."id" = face."asset_id" and asset."owner_id" = face."owner_id"
    where reference."owner_id" = ${ownerId} and reference."entity_id" = ${entityId}
      and entity."image_asset_id" = face."asset_id" and entity."entity_type" = 'person'
      and entity."archived_at" is null and asset."archived_at" is null
  `;
  if (active.length) {
    return;
  }
  await db`delete from "entity_face_reference" where "owner_id" = ${ownerId} and "entity_id" = ${entityId}`;
  await db`
    delete from "asset_depicts_entity" where "owner_id" = ${ownerId} and "entity_id" = ${entityId} and "source" = 'detected'
  `;
  await db`
    update "asset_face" set "matched_entity_id" = null, "matched_reference_face_id" = null,
      "match_similarity" = null, "match_threshold" = null
    where "owner_id" = ${ownerId} and "matched_entity_id" = ${entityId}
  `;
}
