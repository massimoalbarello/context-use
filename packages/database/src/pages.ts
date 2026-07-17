import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  Actor,
  ArchivePageInput,
  CreatePageInput,
  UpdatePageInput,
} from "@context-use/shared";
import { extractAssetLinks, extractPageLinks, extractWikiLinks, wikiLinkCandidatePaths } from "./links.ts";

export class VersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super(`Page changed; current version is ${currentVersion}`);
    this.name = "VersionConflictError";
  }
}

export class PublicationStateError extends Error {
  constructor() {
    super("Published pages must be explicitly unpublished before they can be archived");
    this.name = "PublicationStateError";
  }
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
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

async function insertLinks(
  client: PoolClient,
  versionId: string,
  markdown: string,
  sourcePath: string,
): Promise<void> {
  for (const targetId of extractPageLinks(markdown)) {
    await client.query(
      `INSERT INTO knowledge_page_links(source_version_id, target_page_id)
       SELECT $1, id FROM knowledge_pages WHERE id = $2
       ON CONFLICT DO NOTHING`,
      [versionId, targetId],
    );
  }
  for (const { path } of extractWikiLinks(markdown)) {
    const candidates = wikiLinkCandidatePaths(path, sourcePath);
    await client.query(
      `INSERT INTO knowledge_page_links(source_version_id, target_page_id)
       SELECT $1, id FROM knowledge_pages
       WHERE current_path = ANY($2::text[]) AND archived_at IS NULL
       ORDER BY array_position($2::text[], current_path)
       LIMIT 1
       ON CONFLICT DO NOTHING`,
      [versionId, candidates],
    );
  }
  for (const targetId of extractAssetLinks(markdown)) {
    await client.query(
      `INSERT INTO knowledge_asset_links(source_version_id, target_asset_id)
       SELECT $1, id FROM assets WHERE id = $2 AND deleted_at IS NULL
       ON CONFLICT DO NOTHING`,
      [versionId, targetId],
    );
  }
}

const CURRENT_PAGE_SELECT = `
  SELECT p.id, p.current_path, p.current_version_id, p.published_version_id,
    p.public_slug, p.archived_at, p.created_at, p.updated_at,
    v.version_number, v.title, v.body_markdown
  FROM knowledge_pages p
  JOIN knowledge_page_versions v ON v.id = p.current_version_id AND v.page_id = p.id
`;

export class PageRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreatePageInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      const pageId = randomUUID();
      const versionId = randomUUID();
      await client.query(
        `INSERT INTO knowledge_pages(id, current_path, current_version_id)
         VALUES ($1, $2, $3)`,
        [pageId, input.path, versionId],
      );
      await client.query(
        `INSERT INTO knowledge_page_versions(
          id, page_id, version_number, path, title, body_markdown,
          commit_message, actor_kind, actor_subject
        ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)`,
        [versionId, pageId, input.path, input.title, input.body_markdown, input.commit_message, actor.kind, actor.subject],
      );
      await insertLinks(client, versionId, input.body_markdown, input.path);
      return this.getWith(client, pageId);
    });
  }

  async update(pageId: string, input: UpdatePageInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      const current = await client.query<{ version_number: number }>(
        `${CURRENT_PAGE_SELECT} WHERE p.id = $1 FOR UPDATE OF p`,
        [pageId],
      );
      if (!current.rowCount) return null;
      const currentVersion = current.rows[0]!.version_number;
      if (currentVersion !== input.expected_version_number) throw new VersionConflictError(currentVersion);
      const nextVersion = currentVersion + 1;
      const versionId = randomUUID();
      await client.query(
        `INSERT INTO knowledge_page_versions(
          id, page_id, version_number, path, title, body_markdown,
          commit_message, actor_kind, actor_subject
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [versionId, pageId, nextVersion, input.path, input.title, input.body_markdown, input.commit_message, actor.kind, actor.subject],
      );
      await client.query(
        `UPDATE knowledge_pages
         SET current_path = $2, current_version_id = $3, updated_at = now()
         WHERE id = $1`,
        [pageId, input.path, versionId],
      );
      await insertLinks(client, versionId, input.body_markdown, input.path);
      return this.getWith(client, pageId);
    });
  }

  async archive(pageId: string, input: ArchivePageInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      const current = await client.query<{
        version_number: number;
        current_path: string;
        title: string;
        body_markdown: string;
        published_version_id: string | null;
      }>(`${CURRENT_PAGE_SELECT} WHERE p.id = $1 FOR UPDATE OF p`, [pageId]);
      if (!current.rowCount) return null;
      const row = current.rows[0]!;
      if (row.version_number !== input.expected_version_number) throw new VersionConflictError(row.version_number);
      if (row.published_version_id) throw new PublicationStateError();
      const versionId = randomUUID();
      await client.query(
        `INSERT INTO knowledge_page_versions(
          id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [versionId, pageId, row.version_number + 1, row.current_path, row.title, row.body_markdown, input.commit_message, actor.kind, actor.subject],
      );
      await client.query(
        `UPDATE knowledge_pages SET current_version_id=$2, archived_at=now(),updated_at=now() WHERE id=$1`,
        [pageId, versionId],
      );
      await insertLinks(client, versionId, row.body_markdown, row.current_path);
      return this.getWith(client, pageId);
    });
  }

  async get(pageId: string) {
    const result = await this.pool.query(`${CURRENT_PAGE_SELECT} WHERE p.id = $1`, [pageId]);
    return result.rows[0] ?? null;
  }

  async getByPath(path: string) {
    const result = await this.pool.query(
      `${CURRENT_PAGE_SELECT} WHERE p.current_path = $1 AND p.archived_at IS NULL`,
      [path],
    );
    return result.rows[0] ?? null;
  }

  private async getWith(client: PoolClient, pageId: string) {
    const result = await client.query(`${CURRENT_PAGE_SELECT} WHERE p.id = $1`, [pageId]);
    return result.rows[0] ?? null;
  }

  async list(includeArchived = false) {
    const result = await this.pool.query(
      `${CURRENT_PAGE_SELECT} ${includeArchived ? "" : "WHERE p.archived_at IS NULL"} ORDER BY p.current_path`,
    );
    return result.rows;
  }

  async search(query: string, limit = 30) {
    const result = await this.pool.query(
      `${CURRENT_PAGE_SELECT}
       WHERE p.archived_at IS NULL
         AND v.search_vector @@ websearch_to_tsquery('english', $1)
       ORDER BY ts_rank(v.search_vector, websearch_to_tsquery('english', $1)) DESC
       LIMIT $2`,
      [query, Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows;
  }

  async history(pageId: string) {
    const result = await this.pool.query(
      `SELECT id,page_id,version_number,path,title,commit_message,actor_kind,actor_subject,created_at
       FROM knowledge_page_versions WHERE page_id=$1 ORDER BY version_number DESC`,
      [pageId],
    );
    return result.rows;
  }

  async version(pageId: string, versionNumber: number) {
    const result = await this.pool.query(
      `SELECT id,page_id,version_number,path,title,body_markdown,commit_message,
        actor_kind,actor_subject,created_at
       FROM knowledge_page_versions WHERE page_id=$1 AND version_number=$2`,
      [pageId, versionNumber],
    );
    return result.rows[0] ?? null;
  }

  async links(pageId: string) {
    const outgoing = await this.pool.query(
      `SELECT p.id,p.current_path,v.title
       FROM knowledge_pages source
       JOIN knowledge_page_links l ON l.source_version_id=source.current_version_id
       JOIN knowledge_pages p ON p.id=l.target_page_id
       JOIN knowledge_page_versions v ON v.id=p.current_version_id
       WHERE source.id=$1 AND p.archived_at IS NULL ORDER BY p.current_path`,
      [pageId],
    );
    const backlinks = await this.pool.query(
      `SELECT p.id,p.current_path,v.title
       FROM knowledge_pages p
       JOIN knowledge_page_links l ON l.source_version_id=p.current_version_id
       JOIN knowledge_page_versions v ON v.id=p.current_version_id
       WHERE l.target_page_id=$1 AND p.archived_at IS NULL ORDER BY p.current_path`,
      [pageId],
    );
    return { outgoing: outgoing.rows, backlinks: backlinks.rows };
  }
}
