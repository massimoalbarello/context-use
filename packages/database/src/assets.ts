import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type NewAsset = {
  currentPath: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  contentHash: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export class AssetRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: NewAsset) {
    const id = randomUUID();
    const key = `objects/${id}`;
    const result = await this.pool.query(
      `INSERT INTO assets(id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key,width,height,duration_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id,current_path,public_path,filename,content_type,size_bytes,content_hash,width,height,duration_seconds,published_at,created_at,deleted_at`,
      [id, input.currentPath, input.filename, input.contentType, input.sizeBytes, input.contentHash, key,
        input.width ?? null, input.height ?? null, input.durationSeconds ?? null],
    );
    return { ...result.rows[0], objectKey: key };
  }

  async get(id: string, includeObjectKey = false) {
    const result = await this.pool.query(
      `SELECT id,current_path,public_path,filename,content_type,size_bytes,content_hash,width,height,duration_seconds,
        published_at,created_at,deleted_at${includeObjectKey ? ",s3_object_key" : ""}
       FROM assets WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async getForStorage(id: string) {
    const result = await this.pool.query(
      `SELECT id,s3_object_key,filename,content_type,size_bytes,content_hash
       FROM assets WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async list() {
    const result = await this.pool.query(
      `SELECT id,current_path,public_path,filename,content_type,size_bytes,content_hash,width,height,duration_seconds,
        published_at,created_at,deleted_at FROM assets WHERE deleted_at IS NULL ORDER BY current_path`,
    );
    return result.rows;
  }

  async markDeleted(id: string): Promise<string | null> {
    const result = await this.pool.query<{ s3_object_key: string }>(
      `UPDATE assets SET deleted_at=now()
       WHERE id=$1 AND published_at IS NULL AND deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_asset_links link
           JOIN knowledge_pages page ON page.published_version_id=link.source_version_id
           WHERE link.target_asset_id=assets.id
         )
       RETURNING s3_object_key`,
      [id],
    );
    return result.rows[0]?.s3_object_key ?? null;
  }
}
