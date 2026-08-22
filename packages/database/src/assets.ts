import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { assetFilenameForPath } from "@context-use/shared";

export type AssetArchiveConflictReason = "published" | "referenced";

export class AssetArchiveConflictError extends Error {
  constructor(readonly reason: AssetArchiveConflictReason) {
    super(reason === "published"
      ? "Published assets must be explicitly unpublished before they can be archived"
      : "Assets referenced by an active page cannot be archived");
    this.name = "AssetArchiveConflictError";
  }
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

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
    // Every asset is written through here, so deriving the name once keeps the path and the
    // stored filename from drifting apart no matter which upload surface created the asset.
    const filename = assetFilenameForPath(input.currentPath, input.filename);
    const result = await this.pool.query(
      `INSERT INTO assets(id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key,width,height,duration_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id,current_path,public_path,filename,content_type,size_bytes,content_hash,width,height,duration_seconds,created_at,deleted_at`,
      [id, input.currentPath, filename, input.contentType, input.sizeBytes, input.contentHash, key,
        input.width ?? null, input.height ?? null, input.durationSeconds ?? null],
    );
    return { ...result.rows[0], objectKey: key };
  }

  async get(id: string, includeObjectKey = false) {
    const result = await this.pool.query(
      `SELECT id,current_path,public_path,filename,content_type,size_bytes,content_hash,width,height,duration_seconds,
        created_at,deleted_at${includeObjectKey ? ",s3_object_key" : ""}
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

  async getDeletedForStorage(id: string) {
    const result = await this.pool.query(
      `SELECT id,s3_object_key
       FROM assets WHERE id=$1 AND deleted_at IS NOT NULL`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async list() {
    const result = await this.pool.query(
      `SELECT id,current_path,public_path,filename,content_type,size_bytes,content_hash,width,height,duration_seconds,
        created_at,deleted_at FROM assets WHERE deleted_at IS NULL ORDER BY current_path`,
    );
    return result.rows;
  }

  async archive(id: string) {
    return transaction(this.pool, async (client) => {
      const target = await client.query<{ public_path: string | null }>(
        `SELECT public_path
         FROM assets
         WHERE id=$1 AND deleted_at IS NULL
         FOR UPDATE`,
        [id],
      );
      if (!target.rowCount) return null;
      if (target.rows[0]!.public_path !== null) {
        throw new AssetArchiveConflictError("published");
      }
      const referenced = await client.query(
        `SELECT 1
         FROM knowledge_pages page
         JOIN hypermedia_document_revisions revision
           ON revision.id=page.current_version_id
         WHERE page.archived_at IS NULL
           AND (
             EXISTS (
               SELECT 1 FROM document_links link
               WHERE link.source_revision_id=revision.id
                 AND link.target_document_id=$1
             )
             OR EXISTS (
               SELECT 1 FROM knowledge_asset_links legacy_link
               WHERE legacy_link.source_version_id=revision.id
                 AND legacy_link.target_asset_id=$1
             )
           )
         LIMIT 1`,
        [id],
      );
      if (referenced.rowCount) throw new AssetArchiveConflictError("referenced");
      const archived = await client.query(
        `UPDATE assets
         SET deleted_at=now()
         WHERE id=$1 AND deleted_at IS NULL
         RETURNING id,current_path,public_path,filename,content_type,size_bytes,content_hash,
           width,height,duration_seconds,created_at,deleted_at`,
        [id],
      );
      return archived.rows[0] ?? null;
    });
  }

  async markDeleted(id: string): Promise<string | null> {
    const result = await this.pool.query<{ s3_object_key: string }>(
      `UPDATE assets SET deleted_at=now()
         WHERE id=$1 AND public_path IS NULL AND deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM knowledge_pages page
           JOIN hypermedia_document_revisions revision
             ON revision.id=page.published_version_id
           WHERE page.archived_at IS NULL
             AND (
               EXISTS (
                 SELECT 1 FROM document_links link
                 WHERE link.source_revision_id=revision.id
                   AND link.target_document_id=assets.id
               )
               OR EXISTS (
                 SELECT 1 FROM knowledge_asset_links legacy_link
                 WHERE legacy_link.source_version_id=revision.id
                   AND legacy_link.target_asset_id=assets.id
               )
             )
         )
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_export_intents export
           WHERE export.download_started_at IS NOT NULL AND export.expires_at>now()
         )
       RETURNING s3_object_key`,
      [id],
    );
    return result.rows[0]?.s3_object_key ?? null;
  }
}
