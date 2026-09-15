import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type { ImportedAsset } from '#backend/models/assets/import.ts';
import type { RecordSyncPrincipal } from '#backend/models/syncs/model.ts';
import type { Queries } from '#backend/queries.gen.ts';
import { isActiveSync } from '../sync-acceptance.ts';

export interface AssetImportIdentity extends RecordSyncPrincipal {
  key: string;
}

/** Return an existing publication or rejection; null permits a new asset in this transaction. */
export async function checkAssetImport({
  db,
  input,
  contentHash,
  sizeBytes,
}: {
  db: TypedSQL<Queries>;
  input: AssetImportIdentity;
  contentHash: string;
  sizeBytes: number;
}): Promise<
  { state: 'existing'; asset: ImportedAsset } | { state: 'sync_conflict' | 'inactive_sync' } | null
> {
  if (!(await isActiveSync({ db, ...input }))) {
    return { state: 'inactive_sync' };
  }
  const existing = await findAssetImport({ db, input });
  if (!existing) {
    return null;
  }
  return !existing.archived && existing.sha256 === contentHash && existing.sizeBytes === sizeBytes
    ? { state: 'existing', asset: existing }
    : { state: 'sync_conflict' };
}

export async function findAssetImport({
  db,
  input,
}: {
  db: TypedSQL<Queries>;
  input: AssetImportIdentity;
}): Promise<ImportedAsset | null> {
  const rows = await db.FindImportedAsset`
    /* @notNull assetId sha256 sizeBytes */
    select asset."readable_id" as "assetId", asset."content_hash" as "sha256", asset."size_bytes" as "sizeBytes", asset."archived_at" as "archivedAt"
    from "asset_import" imported join "asset" asset
      on asset."id" = imported."asset_id" and asset."owner_id" = imported."owner_id"
    where imported."owner_id" = ${input.ownerId} and imported."sync_id" = ${input.syncId}
      and imported."import_key" = ${input.key}
  `;
  const row = rows[0];
  return row
    ? {
        assetId: row.assetId,
        sha256: row.sha256,
        sizeBytes: Number(row.sizeBytes),
        archived: row.archivedAt !== null,
      }
    : null;
}
