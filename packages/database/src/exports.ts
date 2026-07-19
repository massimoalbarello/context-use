import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type KnowledgeExportPrincipal = { ownerUserId: string; sessionId: string };

export type KnowledgeExportPage = {
  id: string;
  current_path: string;
  title: string;
  body_markdown: string;
};

export type KnowledgeExportAsset = {
  id: string;
  current_path: string;
  filename: string;
  content_type: string;
  size_bytes: number | string;
  content_hash: string;
  s3_object_key: string;
};

export type KnowledgeExportSnapshot = {
  pages: KnowledgeExportPage[];
  assets: KnowledgeExportAsset[];
};

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

export class KnowledgeExportRepository {
  constructor(
    private readonly dashboardPool: Pool,
    private readonly publisherPool: Pool,
  ) {}

  async createIntent(principal: KnowledgeExportPrincipal, challenge: string) {
    return transaction(this.dashboardPool, async (client) => {
      await client.query(
        `DELETE FROM knowledge_export_intents
         WHERE expires_at <= now()
            OR (owner_user_id=$1 AND session_id=$2 AND download_started_at IS NULL)`,
        [principal.ownerUserId, principal.sessionId],
      );
      const id = randomUUID();
      const inserted = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO knowledge_export_intents(
           id,owner_user_id,session_id,challenge,expires_at
         ) VALUES ($1,$2,$3,$4,now()+interval '5 minutes')
         RETURNING id,expires_at`,
        [id, principal.ownerUserId, principal.sessionId, challenge],
      );
      await client.query(
        `INSERT INTO knowledge_export_pages(intent_id,page_id,version_id)
         SELECT $1,id,current_version_id
         FROM knowledge_pages
         WHERE archived_at IS NULL`,
        [id],
      );
      await client.query(
        `INSERT INTO knowledge_export_assets(
           intent_id,asset_id,current_path,filename,content_type,size_bytes,
           content_hash,s3_object_key
         )
         SELECT $1,id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key
         FROM assets
         WHERE deleted_at IS NULL`,
        [id],
      );
      const summary = await client.query<{
        page_count: string;
        asset_count: string;
        total_bytes: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM knowledge_export_pages WHERE intent_id=$1) AS page_count,
           (SELECT count(*)::text FROM knowledge_export_assets WHERE intent_id=$1) AS asset_count,
           (
             coalesce((
               SELECT sum(octet_length(version.body_markdown))
               FROM knowledge_export_pages page
               JOIN knowledge_page_versions version ON version.id=page.version_id
               WHERE page.intent_id=$1
             ),0)
             + coalesce((
               SELECT sum(size_bytes)
               FROM knowledge_export_assets
               WHERE intent_id=$1
             ),0)
           )::text AS total_bytes`,
        [id],
      );
      return {
        id,
        expires_at: inserted.rows[0]!.expires_at,
        page_count: Number(summary.rows[0]!.page_count),
        asset_count: Number(summary.rows[0]!.asset_count),
        total_bytes: Number(summary.rows[0]!.total_bytes),
      };
    });
  }

  async getIntent(id: string) {
    const result = await this.dashboardPool.query<{
      id: string;
      owner_user_id: string;
      session_id: string;
      challenge: string;
      expires_at: Date;
      confirmed_at: Date | null;
      download_started_at: Date | null;
    }>(
      `SELECT id,owner_user_id,session_id,challenge,expires_at,confirmed_at,download_started_at
       FROM knowledge_export_intents
       WHERE id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async assets(id: string): Promise<KnowledgeExportAsset[]> {
    const result = await this.dashboardPool.query<KnowledgeExportAsset>(
      `SELECT asset_id AS id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key
       FROM knowledge_export_assets
       WHERE intent_id=$1
       ORDER BY current_path,asset_id`,
      [id],
    );
    return result.rows;
  }

  async discard(id: string, principal: KnowledgeExportPrincipal): Promise<void> {
    await this.dashboardPool.query(
      `DELETE FROM knowledge_export_intents
       WHERE id=$1 AND owner_user_id=$2 AND session_id=$3 AND confirmed_at IS NULL`,
      [id, principal.ownerUserId, principal.sessionId],
    );
  }

  async confirm(id: string, principal: KnowledgeExportPrincipal, credentialId: string): Promise<void> {
    await this.publisherPool.query(
      "SELECT confirm_knowledge_export_intent($1,$2,$3,$4)",
      [id, principal.ownerUserId, principal.sessionId, credentialId],
    );
  }

  async claim(id: string, principal: KnowledgeExportPrincipal): Promise<KnowledgeExportSnapshot> {
    await this.publisherPool.query(
      "SELECT claim_knowledge_export_download($1,$2,$3)",
      [id, principal.ownerUserId, principal.sessionId],
    );
    const [pages, assets] = await Promise.all([
      this.dashboardPool.query<KnowledgeExportPage>(
        `SELECT page.page_id AS id,version.path AS current_path,version.title,version.body_markdown
         FROM knowledge_export_pages page
         JOIN knowledge_page_versions version
           ON version.id=page.version_id AND version.page_id=page.page_id
         WHERE page.intent_id=$1
         ORDER BY version.path,page.page_id`,
        [id],
      ),
      this.dashboardPool.query<KnowledgeExportAsset>(
        `SELECT asset_id AS id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key
         FROM knowledge_export_assets
         WHERE intent_id=$1
         ORDER BY current_path,asset_id`,
        [id],
      ),
    ]);
    await this.dashboardPool.query("DELETE FROM knowledge_export_intents WHERE id=$1", [id]);
    return { pages: pages.rows, assets: assets.rows };
  }
}
