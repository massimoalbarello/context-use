import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { Queries } from '#backend/queries.gen.ts';

export interface StoredPublicAsset {
  name: string;
  mediaType: string;
  extension: string | null;
  sizeBytes: number;
  contentHash: string;
  storageKey: string;
}

export interface PublicResourcesRepositoryContract {
  findAsset(input: { publicId: string }): Promise<StoredPublicAsset | null>;
}

export class PublicResourcesRepository implements PublicResourcesRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async findAsset({ publicId }: { publicId: string }): Promise<StoredPublicAsset | null> {
    const rows = await this.sql.FindPublicAsset`
      /* @notNull name mediaType sizeBytes contentHash storageKey */
      select asset."name", asset."media_type" as "mediaType", asset."extension",
        asset."size_bytes" as "sizeBytes", asset."content_hash" as "contentHash",
        asset."storage_key" as "storageKey"
      from "asset" asset
      where asset."public_id" = ${publicId}
        and asset."published_at" is not null and asset."archived_at" is null
    `;
    const row = rows[0];
    return row
      ? {
          name: row.name,
          mediaType: row.mediaType,
          extension: row.extension,
          sizeBytes: Number(row.sizeBytes),
          contentHash: row.contentHash,
          storageKey: row.storageKey,
        }
      : null;
  }
}
