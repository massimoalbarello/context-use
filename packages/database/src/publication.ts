import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PublicationIntentInput } from "@context-use/shared";

function canonicalPayload(input: PublicationIntentInput, publicPath: string | null): string {
  return JSON.stringify({
    action: input.action,
    target_kind: input.target_kind,
    target_id: input.target_id,
    version_id: input.version_id ?? null,
    public_path: publicPath,
  });
}

export function hashPublicationPayload(input: PublicationIntentInput, publicPath: string | null): string {
  return createHash("sha256").update(canonicalPayload(input, publicPath)).digest("hex");
}

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
        session_id,payload_hash,expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '5 minutes')
      RETURNING id,action,target_kind,target_id,version_id,public_path,expires_at`,
      [id, input.action, input.target_kind, input.target_id, input.version_id ?? null,
        publicPath, principal.ownerUserId, principal.sessionId,
        hashPublicationPayload(input, publicPath)],
    );
    return result.rows[0];
  }

  async getIntent(id: string) {
    const result = await this.dashboardPool.query(
      `SELECT id,action,target_kind,target_id,version_id,public_path,owner_user_id,
        session_id,challenge,payload_hash,expires_at,consumed_at
       FROM publication_intents WHERE id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }
}

export class PublicRepository {
  constructor(private readonly pool: Pool) {}

  async pageByPublicPath(path: string) {
    const result = await this.pool.query(
      "SELECT public_path,title,body_markdown FROM published_pages WHERE public_path=$1",
      [path],
    );
    return result.rows[0] ?? null;
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

export type PublicMcpPageSummary = {
  path: string;
  title: string;
  parent_path: string | null;
};

export type PublicMcpPage = PublicMcpPageSummary & {
  body_markdown: string;
};

export type PublicMcpSearchResult = PublicMcpPageSummary & {
  excerpt: string;
};

export class PublicMcpRepository {
  constructor(private readonly pool: Pool) {}

  async listPages(): Promise<PublicMcpPageSummary[]> {
    const result = await this.pool.query<PublicMcpPageSummary>(
      `SELECT public_path AS path,title,parent_path
       FROM public_mcp_pages
       ORDER BY lower(title),public_path`,
    );
    return result.rows;
  }

  async getPage(path: string): Promise<PublicMcpPage | null> {
    const result = await this.pool.query<PublicMcpPage>(
      `SELECT public_path AS path,title,parent_path,body_markdown
       FROM public_mcp_pages
       WHERE public_path=$1`,
      [path],
    );
    return result.rows[0] ?? null;
  }

  async searchPages(query: string, limit: number): Promise<PublicMcpSearchResult[]> {
    const result = await this.pool.query<PublicMcpSearchResult>(
      `WITH searched AS (
         SELECT public_path,title,parent_path,body_markdown,
                websearch_to_tsquery('english',$1) AS query
         FROM public_mcp_pages
       )
       SELECT public_path AS path,title,parent_path,
              ts_headline(
                'english',body_markdown,query,
                'MaxFragments=2,MaxWords=35,MinWords=10,StartSel=**,StopSel=**'
              ) AS excerpt
       FROM searched
       WHERE (
         setweight(to_tsvector('simple',coalesce(title,'')),'A') ||
         setweight(to_tsvector('english',coalesce(body_markdown,'')),'B')
       ) @@ query
       ORDER BY ts_rank(
         setweight(to_tsvector('simple',coalesce(title,'')),'A') ||
         setweight(to_tsvector('english',coalesce(body_markdown,'')),'B'),
         query
       ) DESC,lower(title),public_path
       LIMIT $2`,
      [query, limit],
    );
    return result.rows;
  }
}
