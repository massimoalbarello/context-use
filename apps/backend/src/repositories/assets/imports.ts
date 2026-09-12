import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { ImportedAsset } from '#models/assets/import.ts';
import type { StoredAsset } from '#models/assets/model.ts';
import type { RecordSyncPrincipal } from '#models/syncs/model.ts';
import type { Queries } from '#queries.gen.ts';
import { replaceSearchDocument } from '../search-index.ts';

export interface AssetImportIdentity extends RecordSyncPrincipal {
  key: string;
}

export type AssetImportPublication =
  | { state: 'ready'; asset: ImportedAsset; created: boolean }
  | { state: 'conflict' | 'inactive_sync' };

export interface AssetImportsRepositoryContract {
  find(input: AssetImportIdentity): Promise<ImportedAsset | null>;
  publish(input: AssetImportIdentity & { asset: StoredAsset }): Promise<AssetImportPublication>;
}

/** Owns a dedicated connection so unrelated work cannot enter an upload publication transaction. */
export class AssetImportsRepository implements AssetImportsRepositoryContract {
  private readonly sql: TypedSQL<Queries>;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work);
    this.tail = next.catch(() => undefined);
    return next;
  }

  find(input: AssetImportIdentity): Promise<ImportedAsset | null> {
    return this.serialize(() => findImport({ db: this.sql, input }));
  }

  publish(input: AssetImportIdentity & { asset: StoredAsset }): Promise<AssetImportPublication> {
    return this.serialize(() =>
      this.sql.begin('immediate', async (db) => {
        const active = await db.FindActiveAssetImportSync`
        select "id" from "record_sync"
        where "id" = ${input.syncId} and "owner_id" = ${input.ownerId} and "revoked_at" is null
      `;
        if (!active[0]) {
          return { state: 'inactive_sync' };
        }
        const existing = await findImport({ db, input });
        if (existing) {
          return !existing.archived &&
            existing.sha256 === input.asset.contentHash &&
            existing.sizeBytes === input.asset.sizeBytes
            ? { state: 'ready', asset: existing, created: false }
            : { state: 'conflict' };
        }
        const asset = input.asset;
        await db.InsertImportedAsset`
        insert into "asset" ("id", "owner_id", "readable_id", "name", "media_type", "extension",
          "size_bytes", "content_hash", "storage_key", "created_at", "updated_at")
        values (${asset.id}, ${input.ownerId}, ${asset.readableId}, ${asset.name}, ${asset.mediaType},
          ${asset.extension}, ${asset.sizeBytes}, ${asset.contentHash}, ${asset.storageKey},
          ${asset.createdAt}, ${asset.updatedAt})
      `;
        await db.InsertAssetImport`
        insert into "asset_import" ("owner_id", "sync_id", "import_key", "asset_id")
        values (${input.ownerId}, ${input.syncId}, ${input.key}, ${asset.id})
      `;
        await replaceSearchDocument({
          db,
          ownerId: input.ownerId,
          resourceType: 'asset',
          readableId: asset.readableId,
          label: asset.name,
          metadata: [asset.mediaType, asset.extension].filter(Boolean).join(' '),
        });
        return {
          state: 'ready',
          created: true,
          asset: {
            assetId: asset.readableId,
            archived: false,
            sha256: asset.contentHash,
            sizeBytes: asset.sizeBytes,
          },
        };
      }),
    );
  }
}

async function findImport({
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
