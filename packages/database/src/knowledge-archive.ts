import type { Pool, PoolClient } from "pg";
import {
  mapConcurrently,
  type MarkdownObjectMetadata,
  type MarkdownObjectStore,
} from "./documents.ts";

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
  public_settings?: { entrypoint_page_id: string | null };
  directories: RestorableKnowledgeDirectory[];
  pages: RestorableKnowledgePage[];
  page_versions: RestorableKnowledgePageVersion[];
  assets: RestorableKnowledgeAsset[];
  asset_links: RestorableKnowledgeAssetLink[];
  page_changes: RestorableKnowledgePageChange[];
};

export type KnowledgeImportPrincipal = { ownerUserId: string; sessionId: string };

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  // Production supplies a Pool. A few integration tests deliberately bind the
  // repository to an already-open Client so the complete restore can be rolled
  // back with its fixture; use a savepoint in that case.
  const pooled = "totalCount" in pool;
  const client = pooled ? await pool.connect() : pool as unknown as PoolClient;
  const start = pooled ? "BEGIN" : "SAVEPOINT context_use_archive_repository";
  const commit = pooled ? "COMMIT" : "RELEASE SAVEPOINT context_use_archive_repository";
  const rollback = pooled ? "ROLLBACK" : "ROLLBACK TO SAVEPOINT context_use_archive_repository";
  try {
    await client.query(start);
    const result = await work(client);
    await client.query(commit);
    return result;
  } catch (error) {
    await client.query(rollback);
    if (!pooled) await client.query("RELEASE SAVEPOINT context_use_archive_repository");
    throw error;
  } finally {
    if (pooled) client.release();
  }
}

export class KnowledgeArchiveRepository {
  constructor(
    private readonly dashboardPool: Pool,
    private readonly bodies?: MarkdownObjectStore,
  ) {}

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
    const snapshot = await transaction(this.dashboardPool, async (client) => {
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
      const pageVersions = await client.query<Omit<RestorableKnowledgePageVersion, "body_markdown"> & MarkdownObjectMetadata & { legacy_body_markdown: string | null }>(
        `SELECT version.id,version.page_id,version.version_number,version.path,
           version.title,version.summary,version.body_markdown AS legacy_body_markdown,
           object.body_object_key,object.body_size_bytes,object.body_content_hash,
           version.commit_message,version.actor_kind,version.actor_subject,
           version.created_at::text
         FROM knowledge_page_versions version
         JOIN hypermedia_document_revisions object ON object.id=version.id
         ORDER BY version.page_id,version.version_number,version.id`,
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
      const publicSettings = await client.query<{ entrypoint_page_id: string | null }>(
        "SELECT entrypoint_page_id FROM public_knowledge_settings WHERE singleton",
      );
      return {
        public_settings: publicSettings.rows[0] ?? { entrypoint_page_id: null },
        directories: directories.rows,
        pages: pages.rows,
        page_versions: pageVersions.rows,
        assets: assets.rows,
        asset_links: assetLinks.rows,
        page_changes: pageChanges.rows,
      };
    });
    const pageVersions = await mapConcurrently(snapshot.page_versions, 8, async (version) => {
      const {
        legacy_body_markdown,body_object_key,body_size_bytes,body_content_hash,...metadata
      } = version;
      const body_markdown = legacy_body_markdown ?? await this.bodies?.read({
        body_object_key,
        body_size_bytes: Number(body_size_bytes),
        body_content_hash,
      });
      if (body_markdown === undefined) throw new Error("Knowledge document object store is required");
      return { ...metadata, body_markdown };
    });
    return { ...snapshot, page_versions: pageVersions };
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
    return transaction(this.dashboardPool, async (client) => {
      const intent = await client.query<{ archive: RestorableKnowledgeRecords }>(
        "SELECT archive FROM knowledge_import_intents WHERE id=$1",
        [id],
      );
      const result = await client.query<{ result: Record<string, number> }>(
        "SELECT restore_knowledge_import($1,$2,$3) AS result",
        [id, principal.ownerUserId, principal.sessionId],
      );
      const entrypointPageId = intent.rows[0]?.archive.public_settings?.entrypoint_page_id ?? null;
      const updated = await client.query(
        `UPDATE public_knowledge_settings settings
         SET entrypoint_page_id=published.id,updated_at=now()
         FROM (SELECT $1::uuid AS id) published
         WHERE settings.singleton AND (
           published.id IS NULL OR EXISTS (
             SELECT 1 FROM knowledge_pages page
             WHERE page.id=published.id AND page.published_version_id IS NOT NULL
               AND page.public_path IS NOT NULL AND page.archived_at IS NULL
           )
         )`,
        [entrypointPageId],
      );
      if (updated.rowCount !== 1) throw new Error("Restored public entry point is invalid");
      return result.rows[0]!.result;
    });
  }
}
