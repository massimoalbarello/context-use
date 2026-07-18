import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PublicationIntentInput } from "@context-use/shared";

function canonicalPayload(input: PublicationIntentInput): string {
  return JSON.stringify({
    action: input.action,
    target_kind: input.target_kind,
    target_id: input.target_id,
    version_id: input.version_id ?? null,
    public_slug: input.public_slug ?? null,
  });
}

export function hashPublicationPayload(input: PublicationIntentInput): string {
  return createHash("sha256").update(canonicalPayload(input)).digest("hex");
}

export class PublicationRepository {
  constructor(
    private readonly dashboardPool: Pool,
    private readonly publisherPool: Pool,
  ) {}

  async createIntent(
    input: PublicationIntentInput,
    principal: { ownerUserId: string; sessionId: string },
    challenge: string,
  ) {
    const id = randomUUID();
    const result = await this.dashboardPool.query(
      `INSERT INTO publication_intents(
        id,action,target_kind,target_id,version_id,public_slug,owner_user_id,
        session_id,challenge,payload_hash,expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '5 minutes')
      RETURNING id,action,target_kind,target_id,version_id,public_slug,challenge,expires_at`,
      [id, input.action, input.target_kind, input.target_id, input.version_id ?? null,
        input.public_slug ?? null, principal.ownerUserId, principal.sessionId, challenge,
        hashPublicationPayload(input)],
    );
    return result.rows[0];
  }

  async getIntent(id: string) {
    const result = await this.dashboardPool.query(
      `SELECT id,action,target_kind,target_id,version_id,public_slug,owner_user_id,
        session_id,challenge,payload_hash,expires_at,consumed_at
       FROM publication_intents WHERE id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async confirm(intentId: string, ownerUserId: string, sessionId: string, credentialId: string) {
    await this.publisherPool.query(
      "SELECT confirm_publication_intent($1,$2,$3,$4)",
      [intentId, ownerUserId, sessionId, credentialId],
    );
  }
}

export class PublicRepository {
  constructor(private readonly pool: Pool) {}

  async pageBySlug(slug: string) {
    const result = await this.pool.query("SELECT * FROM published_pages WHERE public_slug=$1", [slug]);
    return result.rows[0] ?? null;
  }

  async pageById(id: string) {
    const result = await this.pool.query("SELECT * FROM published_pages WHERE id=$1", [id]);
    return result.rows[0] ?? null;
  }

  async pageByPath(path: string) {
    const result = await this.pool.query(
      "SELECT * FROM published_pages WHERE path=$1 ORDER BY version_created_at DESC LIMIT 1",
      [path],
    );
    return result.rows[0] ?? null;
  }

  async asset(id: string) {
    const result = await this.pool.query("SELECT * FROM published_assets WHERE id=$1", [id]);
    return result.rows[0] ?? null;
  }
}

export type PublicMcpPageSummary = {
  slug: string;
  title: string;
  parent_slug: string | null;
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
      `SELECT public_slug AS slug,title,parent_slug
       FROM public_mcp_pages
       ORDER BY lower(title),public_slug`,
    );
    return result.rows;
  }

  async getPage(slug: string): Promise<PublicMcpPage | null> {
    const result = await this.pool.query<PublicMcpPage>(
      `SELECT public_slug AS slug,title,parent_slug,body_markdown
       FROM public_mcp_pages
       WHERE public_slug=$1`,
      [slug],
    );
    return result.rows[0] ?? null;
  }

  async searchPages(query: string, limit: number): Promise<PublicMcpSearchResult[]> {
    const result = await this.pool.query<PublicMcpSearchResult>(
      `WITH searched AS (
         SELECT public_slug,title,parent_slug,body_markdown,
                websearch_to_tsquery('english',$1) AS query
         FROM public_mcp_pages
       )
       SELECT public_slug AS slug,title,parent_slug,
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
       ) DESC,lower(title),public_slug
       LIMIT $2`,
      [query, limit],
    );
    return result.rows;
  }
}
