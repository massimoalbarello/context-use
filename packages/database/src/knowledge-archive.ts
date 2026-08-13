import type { Pool, PoolClient } from "pg";

export const RESTORABLE_KNOWLEDGE_FORMAT = "context-use-restorable-knowledge-v1" as const;

export type RestorableKnowledgeDirectory = {
  id: string;
  current_path: string;
  version_number: number;
  title: string;
  summary: string;
  created_at: string;
  updated_at: string;
};

export type RestorableKnowledgePage = {
  id: string;
  current_path: string;
  current_version_id: string;
  published_version_id: string | null;
  public_path: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type RestorableKnowledgePageVersion = {
  id: string;
  page_id: string;
  version_number: number;
  path: string;
  title: string;
  summary: string;
  body_markdown: string;
  commit_message: string;
  actor_kind: "dashboard" | "mcp";
  actor_subject: string;
  created_at: string;
};

export type RestorableKnowledgeAsset = {
  id: string;
  current_path: string;
  public_path: string | null;
  filename: string;
  content_type: string;
  size_bytes: string;
  content_hash: string;
  s3_object_key: string;
  width: number | null;
  height: number | null;
  duration_seconds: string | null;
  created_at: string;
  deleted_at: string | null;
};

export type RestorableKnowledgeAssetLink = {
  source_version_id: string;
  target_asset_id: string;
  created_at: string;
};

export type RestorableKnowledgePageChange = {
  change_sequence: string;
  page_id: string;
  version_id: string;
  version_number: number;
  change_kind: "created" | "updated" | "archived" | "deleted";
  path: string;
  title: string;
  commit_message: string;
  actor_kind: "dashboard" | "mcp" | null;
  actor_subject: string | null;
  changed_at: string;
};

export type RestorableKnowledgeRecords = {
  directories: RestorableKnowledgeDirectory[];
  pages: RestorableKnowledgePage[];
  page_versions: RestorableKnowledgePageVersion[];
  assets: RestorableKnowledgeAsset[];
  asset_links: RestorableKnowledgeAssetLink[];
  page_changes: RestorableKnowledgePageChange[];
};

export type KnowledgeImportPrincipal = { ownerUserId: string; sessionId: string };

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

export class KnowledgeArchiveRepository {
  constructor(private readonly dashboardPool: Pool) {}

  async importAvailable(): Promise<boolean> {
    // The durable change ledger covers every retained and deleted page version,
    // so only assets and otherwise-invisible empty directories need separate checks.
    // restore_knowledge_import remains the race-safe authority.
    const result = await this.dashboardPool.query<{ eligible: boolean }>(
      `SELECT
         NOT EXISTS (SELECT 1 FROM assets)
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_page_changes
           WHERE coalesce(actor_subject,'')<>'context-use-bootstrap'
             AND coalesce(actor_subject,'') NOT LIKE 'context-use-template/%'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM knowledge_directories directory
           WHERE directory.current_path NOT IN ('','automations')
             AND NOT EXISTS (
               SELECT 1 FROM knowledge_pages page
               WHERE page.current_path LIKE directory.current_path||'/%'
             )
         )
       AS eligible`,
    );
    return result.rows[0]?.eligible === true;
  }

  async snapshot(): Promise<RestorableKnowledgeRecords> {
    return transaction(this.dashboardPool, async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      const directories = await client.query<RestorableKnowledgeDirectory>(
        `SELECT id,current_path,version_number,title,summary,
           created_at::text,updated_at::text
         FROM knowledge_directories
         ORDER BY current_path,id`,
      );
      const pages = await client.query<RestorableKnowledgePage>(
        `SELECT id,current_path,current_version_id,published_version_id,public_path,
           created_at::text,updated_at::text,archived_at::text
         FROM knowledge_pages
         ORDER BY current_path,id`,
      );
      const pageVersions = await client.query<RestorableKnowledgePageVersion>(
        `SELECT id,page_id,version_number,path,title,summary,body_markdown,
           commit_message,actor_kind,actor_subject,created_at::text
         FROM knowledge_page_versions
         ORDER BY page_id,version_number,id`,
      );
      const assets = await client.query<RestorableKnowledgeAsset>(
        `SELECT id,current_path,public_path,filename,content_type,size_bytes::text,
           content_hash,s3_object_key,width,height,duration_seconds::text,
           created_at::text,deleted_at::text
         FROM assets
         ORDER BY current_path,id`,
      );
      const assetLinks = await client.query<RestorableKnowledgeAssetLink>(
        `SELECT source_version_id,target_asset_id,created_at::text
         FROM knowledge_asset_links
         ORDER BY source_version_id,target_asset_id`,
      );
      const pageChanges = await client.query<RestorableKnowledgePageChange>(
        `SELECT change_sequence::text,page_id,version_id,version_number,change_kind,
           path,title,commit_message,actor_kind,actor_subject,changed_at::text
         FROM knowledge_page_changes
         ORDER BY knowledge_page_changes.change_sequence`,
      );
      return {
        directories: directories.rows,
        pages: pages.rows,
        page_versions: pageVersions.rows,
        assets: assets.rows,
        asset_links: assetLinks.rows,
        page_changes: pageChanges.rows,
      };
    });
  }

  async createImportIntent(input: {
    id: string;
    principal: KnowledgeImportPrincipal;
    archive: RestorableKnowledgeRecords;
    archiveSha256: string;
  }) {
    return transaction(this.dashboardPool, async (client) => {
      const discarded = await client.query<{ id: string; archive: RestorableKnowledgeRecords }>(
        `DELETE FROM knowledge_import_intents
         WHERE consumed_at IS NOT NULL OR expires_at<=now()
           OR (owner_user_id=$1 AND session_id=$2 AND confirmed_at IS NULL)
         RETURNING id,archive`,
        [input.principal.ownerUserId, input.principal.sessionId],
      );
      const activeAssets = input.archive.assets.filter((asset) => !asset.deleted_at);
      const result = await client.query<{ expires_at: Date }>(
        `INSERT INTO knowledge_import_intents(
           id,owner_user_id,session_id,archive,archive_sha256,
           active_asset_count,total_asset_bytes,expires_at
         ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,now()+interval '15 minutes')
         RETURNING expires_at`,
        [
          input.id,
          input.principal.ownerUserId,
          input.principal.sessionId,
          JSON.stringify(input.archive),
          input.archiveSha256,
          activeAssets.length,
          activeAssets.reduce((total, asset) => total + Number(asset.size_bytes), 0),
        ],
      );
      return {
        id: input.id,
        expires_at: result.rows[0]!.expires_at,
        discarded_imports: discarded.rows,
      };
    });
  }

  async getImportIntent(id: string) {
    const result = await this.dashboardPool.query<{
      id: string;
      owner_user_id: string;
      session_id: string;
      archive: RestorableKnowledgeRecords;
      archive_sha256: string;
      expires_at: Date;
      confirmed_at: Date | null;
      consumed_at: Date | null;
    }>(
      `SELECT id,owner_user_id,session_id,archive,archive_sha256,
         expires_at,confirmed_at,consumed_at
       FROM knowledge_import_intents
       WHERE id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async discardImportIntent(id: string, principal: KnowledgeImportPrincipal): Promise<void> {
    await this.dashboardPool.query(
      `DELETE FROM knowledge_import_intents
       WHERE id=$1 AND owner_user_id=$2 AND session_id=$3 AND confirmed_at IS NULL`,
      [id, principal.ownerUserId, principal.sessionId],
    );
  }

  async restoreImportIntent(id: string, principal: KnowledgeImportPrincipal): Promise<Record<string, number>> {
    const result = await this.dashboardPool.query<{ result: Record<string, number> }>(
      "SELECT restore_knowledge_import($1,$2,$3) AS result",
      [id, principal.ownerUserId, principal.sessionId],
    );
    return result.rows[0]!.result;
  }
}
