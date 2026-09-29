import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { StoredAssetPreview } from '#backend/models/assets/preview.ts';
import type { Queries } from '#backend/queries.gen.ts';

export interface PreviewSource {
  ownerId: string;
  id: string;
  storageKey: string;
  sizeBytes: number;
  mediaType: string;
}

export interface AssetPreviewsRepositoryContract {
  next(): Promise<PreviewSource | null>;
  complete(input: { source: PreviewSource; preview?: StoredAssetPreview }): Promise<void>;
}

export class AssetPreviewsRepository implements AssetPreviewsRepositoryContract {
  private readonly sql: TypedSQL<Queries>;
  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async next(): Promise<PreviewSource | null> {
    const rows = await this.sql.NextAssetPreview`
      /* @notNull id ownerId storageKey sizeBytes mediaType */
      select "id", "owner_id" as "ownerId", "storage_key" as "storageKey",
        "size_bytes" as "sizeBytes", "media_type" as "mediaType"
      from "asset"
      where "archived_at" is null and "preview_attempted_at" is null
        and ("media_type" like 'image/%' or "media_type" like 'video/%')
      order by "created_at", "id" limit 1
    `;
    return rows[0] ? { ...rows[0], sizeBytes: Number(rows[0].sizeBytes) } : null;
  }

  async complete({ source, preview }: { source: PreviewSource; preview?: StoredAssetPreview }) {
    await this.sql.CompleteAssetPreview`
      update "asset" set "preview_metadata" = ${preview ? JSON.stringify(preview) : null},
        "preview_attempted_at" = ${new Date().toISOString()}
      where "id" = ${source.id} and "owner_id" = ${source.ownerId}
        and "preview_attempted_at" is null
    `;
  }
}
