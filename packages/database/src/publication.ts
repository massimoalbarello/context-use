import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PublicationIntentInput } from "@context-use/shared";

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
    const result = await this.pool.query(
      "SELECT public_path,title,summary,body_markdown,last_edited_at FROM published_pages WHERE public_path=$1",
      [path],
    );
    return result.rows[0] ?? null;
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
    }>(
      `WITH descendants AS (
         SELECT public_path,title,summary,
           CASE WHEN $1='' THEN public_path
                ELSE substr(public_path,length($1)+2)
           END AS relative_path
         FROM published_pages
         WHERE $1='' OR left(public_path,length($1)+1)=$1||'/'
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
         SELECT 'directory'::text AS kind,
           CASE WHEN $1='' THEN split_part(relative_path,'/',1)
                ELSE $1||'/'||split_part(relative_path,'/',1)
           END AS path,
           NULL::text AS title,NULL::text AS summary,count(*) AS published_count,
           CASE
             WHEN count(*)=1 AND bool_and(
               strpos(substr(relative_path,strpos(relative_path,'/')+1),'/')=0
             )
             THEN min(public_path)
             ELSE NULL
           END AS default_page_path
         FROM descendants
         WHERE strpos(relative_path,'/')>0
         GROUP BY 2
       )
       SELECT kind,path,title,summary,published_count,default_page_path,
         (SELECT default_page_path FROM index_default) AS index_default_page_path
       FROM child_directories
       UNION ALL
       SELECT kind,path,title,summary,published_count,default_page_path,
         (SELECT default_page_path FROM index_default) AS index_default_page_path
       FROM direct_pages
       ORDER BY path,kind`,
      [path],
    );
    if (!result.rowCount) return null;
    return {
      path,
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
}
