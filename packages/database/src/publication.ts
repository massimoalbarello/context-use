import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PublicationIntentInput } from "@context-use/shared";

export type PublicPage = {
  public_path: string;
  title: string;
  summary: string;
  body_markdown: string;
  last_edited_at: string | Date;
};

export type PublicKnowledgeSettings = {
  entrypoint_public_path: string | null;
};

export class PublicationRepository {
  constructor(private readonly dashboardPool: Pool) {}

  async createIntent(
    input: PublicationIntentInput,
    principal: { ownerUserId: string; sessionId: string },
    publicPath: string | null,
  ) {
    const id = randomUUID();
    const result = await this.dashboardPool.query(
      `INSERT INTO publication_intents(
        id,action,target_kind,target_id,version_id,public_path,owner_user_id,
        session_id,expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '5 minutes')
      RETURNING id,action,target_kind,target_id,version_id,public_path,expires_at`,
      [id, input.action, input.target_kind, input.target_id, input.version_id ?? null,
        publicPath, principal.ownerUserId, principal.sessionId],
    );
    return result.rows[0];
  }

}

export class PublicRepository {
  constructor(private readonly pool: Pool) {}

  async pageByPublicPath(path: string) {
    const result = await this.pool.query<PublicPage>(
      "SELECT public_path,title,summary,body_markdown,last_edited_at FROM published_pages WHERE public_path=$1",
      [path],
    );
    return result.rows[0] ?? null;
  }

  async publishedPages(): Promise<PublicPage[]> {
    const result = await this.pool.query<PublicPage>(
      `SELECT public_path,title,summary,body_markdown,last_edited_at
       FROM published_pages
       ORDER BY public_path COLLATE "C"`,
    );
    return result.rows;
  }

  async settings(): Promise<PublicKnowledgeSettings> {
    const result = await this.pool.query<PublicKnowledgeSettings>(
      "SELECT entrypoint_public_path FROM published_site_settings",
    );
    return result.rows[0] ?? { entrypoint_public_path: null };
  }

  async directoryIndex(path: string) {
    const result = await this.pool.query<{
      kind: "directory" | "page";
      path: string;
      title: string | null;
      summary: string | null;
      published_count: string;
      default_page_path: string | null;
      index_default_page_path: string | null;
      index_title: string;
      index_summary: string;
    }>(
      `WITH descendants AS (
         SELECT public_path,title,summary,
           CASE WHEN $1='' THEN public_path
                ELSE substr(public_path,length($1)+2)
           END AS relative_path
         FROM published_pages
         WHERE $1='' OR left(public_path,length($1)+1)=$1||'/'
       ), current_directory AS (
         SELECT title,summary
         FROM published_directories
         WHERE path=$1
       ), index_default AS (
         SELECT CASE
           WHEN $1<>'' AND count(*)=1 AND bool_and(strpos(relative_path,'/')=0)
           THEN min(public_path)
           ELSE NULL
         END AS default_page_path
         FROM descendants
       ), direct_pages AS (
         SELECT 'page'::text AS kind,public_path AS path,title,summary,
           1::bigint AS published_count,NULL::text AS default_page_path
         FROM descendants
         WHERE strpos(relative_path,'/')=0
       ), child_directories AS (
         SELECT
           CASE WHEN $1='' THEN split_part(relative_path,'/',1)
                ELSE $1||'/'||split_part(relative_path,'/',1)
           END AS path,
           count(*) AS published_count,
           CASE
             WHEN count(*)=1 AND bool_and(
               strpos(substr(relative_path,strpos(relative_path,'/')+1),'/')=0
             )
             THEN min(public_path)
             ELSE NULL
           END AS default_page_path
         FROM descendants
         WHERE strpos(relative_path,'/')>0
         GROUP BY 1
       ), described_child_directories AS (
         SELECT 'directory'::text AS kind,child.path,
           directory.title,directory.summary,child.published_count,
           child.default_page_path
         FROM child_directories child
         JOIN published_directories directory ON directory.path=child.path
       )
       SELECT kind,path,title,summary,published_count,default_page_path,
         (SELECT default_page_path FROM index_default) AS index_default_page_path,
         (SELECT title FROM current_directory) AS index_title,
         (SELECT summary FROM current_directory) AS index_summary
       FROM described_child_directories
       UNION ALL
       SELECT kind,path,title,summary,published_count,default_page_path,
         (SELECT default_page_path FROM index_default) AS index_default_page_path,
         (SELECT title FROM current_directory) AS index_title,
         (SELECT summary FROM current_directory) AS index_summary
       FROM direct_pages
       ORDER BY path,kind`,
      [path],
    );
    if (!result.rowCount) return null;
    return {
      path,
      title: result.rows[0]!.index_title,
      summary: result.rows[0]!.index_summary,
      default_page_path: result.rows[0]!.index_default_page_path,
      entries: result.rows.map((row) => ({
        kind: row.kind,
        path: row.path,
        title: row.title,
        summary: row.summary,
        published_count: Number(row.published_count),
        default_page_path: row.default_page_path,
      })),
    };
  }

  async assetByPublicPath(path: string) {
    const result = await this.pool.query(
      "SELECT public_path,filename,content_type,size_bytes FROM published_assets WHERE public_path=$1",
      [path],
    );
    return result.rows[0] ?? null;
  }
}

export class StoragePublicationRepository {
  constructor(private readonly pool: Pool) {}

  async assetByPublicPath(path: string) {
    const result = await this.pool.query(
      "SELECT public_path,s3_object_key FROM storage_published_assets WHERE public_path=$1",
      [path],
    );
    return result.rows[0] ?? null;
  }

  async pageByPublicPath(path: string) {
    const result = await this.pool.query(
      `SELECT public_path,body_object_key,body_size_bytes,body_content_hash
       FROM storage_published_pages WHERE public_path=$1`,
      [path],
    );
    return result.rows[0] ?? null;
  }
}

export class PublicEntrypointRepository {
  constructor(private readonly pool: Pool) {}

  async get() {
    const result = await this.pool.query(
      `SELECT settings.entrypoint_page_id,page.current_path,page.public_path,
         version.title,version.summary
       FROM public_knowledge_settings settings
       LEFT JOIN knowledge_pages page ON page.id=settings.entrypoint_page_id
       LEFT JOIN knowledge_page_versions version
         ON version.id=page.published_version_id AND version.page_id=page.id
       WHERE settings.singleton`,
    );
    return result.rows[0] ?? null;
  }

  async candidates() {
    const result = await this.pool.query(
      `SELECT page.id,page.public_path,version.title,version.summary
       FROM knowledge_pages page
       JOIN knowledge_page_versions version
         ON version.id=page.published_version_id AND version.page_id=page.id
       WHERE page.published_version_id IS NOT NULL
         AND page.public_path IS NOT NULL
         AND page.archived_at IS NULL
       ORDER BY page.public_path`,
    );
    return result.rows;
  }

  async update(pageId: string | null) {
    const result = await this.pool.query(
      `UPDATE public_knowledge_settings
       SET entrypoint_page_id=$1,updated_at=now()
       WHERE singleton AND ($1::uuid IS NULL OR EXISTS (
         SELECT 1 FROM knowledge_pages page
         WHERE page.id=$1 AND page.published_version_id IS NOT NULL
           AND page.public_path IS NOT NULL AND page.archived_at IS NULL
       ))
       RETURNING entrypoint_page_id,updated_at`,
      [pageId],
    );
    return result.rows[0] ?? null;
  }
}
