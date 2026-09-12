import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type { AssetSummary } from '#models/assets/model.ts';
import type { Queries } from '#queries.gen.ts';

interface RecordAssetIdentity {
  db: TypedSQL<Queries>;
  ownerId: string;
  readableId: string;
}

/** Called inside record acceptance, after revision checks, for each final changed record. */
export async function replaceRecordAssets({
  db,
  ownerId,
  readableId,
  assetIds,
}: RecordAssetIdentity & {
  assetIds: string[];
}): Promise<boolean> {
  const ids = JSON.stringify([...new Set(assetIds)]);
  const missing = await db.FindUnavailableRecordAssets`
    select requested.value from json_each(${ids}) requested
    where not exists (
      select 1 from asset where owner_id = ${ownerId} and readable_id = requested.value
        and archived_at is null
    ) limit 1
  `;
  if (missing.length > 0) {
    return false;
  }
  await db.RemoveRecordAssetReferences`
    delete from record_asset_reference where owner_id = ${ownerId} and record_readable_id = ${readableId}
  `;
  await db.InsertRecordAssetReferences`
    insert into record_asset_reference (owner_id, record_readable_id, asset_id)
    select ${ownerId}, ${readableId}, id from asset
    where owner_id = ${ownerId} and readable_id in (select value from json_each(${ids}))
  `;
  return true;
}

export async function listRecordAssets({
  db,
  ownerId,
  readableId,
}: RecordAssetIdentity): Promise<AssetSummary[]> {
  const rows = await db.ListRecordAssets`
    /* @notNull id readableId name mediaType sizeBytes createdAt updatedAt */
    select asset.id, asset.readable_id as readableId, asset.name, asset.media_type as mediaType,
      asset.extension, asset.size_bytes as sizeBytes, asset.created_at as createdAt, asset.updated_at as updatedAt
    from record_asset_reference reference join asset
      on asset.id = reference.asset_id and asset.owner_id = reference.owner_id
    where reference.owner_id = ${ownerId} and reference.record_readable_id = ${readableId}
    order by asset.name, asset.readable_id
  `;
  return rows.map((row) => ({ ...row, sizeBytes: Number(row.sizeBytes) }));
}
