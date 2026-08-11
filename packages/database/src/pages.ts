import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  Actor,
  ArchivePageInput,
  CreatePageInput,
  PageMetadata,
  UpdatePageInput,
} from "@context-use/shared";
import { extractAssetLinks, normalizeInternalPageLinks } from "./links.ts";
import { prunePageVersions } from "./page-retention.ts";

const CHANGE_CURSOR_PREFIX = "cu-page-changes-v1.";
const CHANGE_PAGE_TOKEN_PREFIX = "cu-page-scan-v1.";
const MAX_BIGINT = 9_223_372_036_854_775_807n;

export type KnowledgePageChangeKind = "created" | "updated" | "archived" | "deleted";

export type KnowledgePageChange = {
  cursor: string;
  page_id: string;
  version_id: string;
  version_number: number;
  previous_version_number?: number | null;
  change_kind: KnowledgePageChangeKind;
  path: string;
  title: string;
  commit_message: string;
  actor_kind: Actor["kind"] | null;
  actor_subject: string | null;
  changed_at: Date | string;
};

export type KnowledgePageChangeBatch = {
  changes: KnowledgePageChange[];
  next_cursor: string;
  next_page_token?: string;
  has_more: boolean;
};

type KnowledgePageChangeRow = Omit<KnowledgePageChange, "cursor"> & {
  change_sequence: string;
};

function parseBase36(value: string): bigint {
  if (!/^[0-9a-z]+$/.test(value)) throw new Error("Invalid knowledge page change cursor");
  let result = 0n;
  for (const character of value) {
    const digit = BigInt(parseInt(character, 36));
    result = result * 36n + digit;
    if (result > MAX_BIGINT) throw new Error("Invalid knowledge page change cursor");
  }
  return result;
}

function changeCursor(sequence: string | bigint): string {
  return `${CHANGE_CURSOR_PREFIX}${BigInt(sequence).toString(36)}`;
}

function parseChangeCursor(cursor?: string): bigint {
  if (!cursor) return 0n;
  if (!cursor.startsWith(CHANGE_CURSOR_PREFIX)) {
    throw new Error("Invalid knowledge page change cursor");
  }
  return parseBase36(cursor.slice(CHANGE_CURSOR_PREFIX.length));
}

function pageToken(after: bigint, through: bigint, position: bigint): string {
  return `${CHANGE_PAGE_TOKEN_PREFIX}${after.toString(36)}.${through.toString(36)}.${position.toString(36)}`;
}

function parsePageToken(token: string): { after: bigint; through: bigint; position: bigint } {
  if (!token.startsWith(CHANGE_PAGE_TOKEN_PREFIX)) {
    throw new Error("Invalid knowledge page change page token");
  }
  const parts = token.slice(CHANGE_PAGE_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 3) throw new Error("Invalid knowledge page change page token");
  const after = parseBase36(parts[0]!);
  const through = parseBase36(parts[1]!);
  const position = parseBase36(parts[2]!);
  if (after > position || position > through) {
    throw new Error("Invalid knowledge page change page token");
  }
  return { after, through, position };
}

function pageChange(row: KnowledgePageChangeRow): KnowledgePageChange {
  const { change_sequence, ...change } = row;
  return { cursor: changeCursor(change_sequence), ...change };
}

async function knowledgeChangeWindowHead(pool: Pool, after: bigint): Promise<bigint> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Ledger writers take this same transaction lock before allocating their
    // sequence. Query max in the following READ COMMITTED statement so every
    // writer serialized before this cutoff is visible and every later writer
    // receives a sequence above it.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('knowledge-page-change-ledger',0))",
    );
    const head = await client.query<{ change_sequence: string }>(
      `SELECT GREATEST($1::bigint,COALESCE(max(change_sequence),0))::text AS change_sequence
       FROM knowledge_page_changes`,
      [after.toString()],
    );
    await client.query("COMMIT");
    return BigInt(head.rows[0]?.change_sequence ?? after);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

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

async function insertAssetLinks(
  client: PoolClient,
  versionId: string,
  markdown: string,
): Promise<void> {
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
    p.public_path, p.archived_at, p.created_at, p.updated_at,
    v.version_number, v.title, v.summary, v.body_markdown
  FROM knowledge_pages p
  JOIN knowledge_page_versions v ON v.id = p.current_version_id AND v.page_id = p.id
`;

const CURRENT_PAGE_METADATA_SELECT = `
  SELECT p.id,p.current_path,p.current_version_id,p.published_version_id,
    p.archived_at,p.updated_at,v.version_number,v.title,v.summary
  FROM knowledge_pages p
  JOIN knowledge_page_versions v ON v.id=p.current_version_id AND v.page_id=p.id
`;

export class PageRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreatePageInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      const pageId = randomUUID();
      const versionId = randomUUID();
      const bodyMarkdown = normalizeInternalPageLinks(input.body_markdown);
      await client.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,search_vector)
         VALUES ($1,$2,$3,page_search_vector($2,$4,$5,$6))`,
        [pageId, input.path, versionId, input.title, input.summary, bodyMarkdown],
      );
      await client.query(
        `INSERT INTO knowledge_page_versions(
          id, page_id, version_number, path, title, summary, body_markdown,
          commit_message, actor_kind, actor_subject
        ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)`,
        [versionId, pageId, input.path, input.title, input.summary, bodyMarkdown, input.commit_message, actor.kind, actor.subject],
      );
      await insertAssetLinks(client, versionId, bodyMarkdown);
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
      const bodyMarkdown = normalizeInternalPageLinks(input.body_markdown);
      await client.query(
        `INSERT INTO knowledge_page_versions(
          id, page_id, version_number, path, title, summary, body_markdown,
          commit_message, actor_kind, actor_subject
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [versionId, pageId, nextVersion, input.path, input.title, input.summary, bodyMarkdown, input.commit_message, actor.kind, actor.subject],
      );
      await client.query(
        `UPDATE knowledge_pages
         SET current_path=$2,current_version_id=$3,
             search_vector=page_search_vector($2,$4,$5,$6),updated_at=now()
         WHERE id = $1`,
        [pageId, input.path, versionId, input.title, input.summary, bodyMarkdown],
      );
      await insertAssetLinks(client, versionId, bodyMarkdown);
      await prunePageVersions(client, pageId);
      return this.getWith(client, pageId);
    });
  }

  async archive(pageId: string, input: ArchivePageInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      const current = await client.query<{
        version_number: number;
        current_path: string;
        title: string;
        summary: string;
        body_markdown: string;
        published_version_id: string | null;
      }>(`${CURRENT_PAGE_SELECT} WHERE p.id = $1 FOR UPDATE OF p`, [pageId]);
      if (!current.rowCount) return null;
      const row = current.rows[0]!;
      if (row.version_number !== input.expected_version_number) throw new VersionConflictError(row.version_number);
      if (row.published_version_id) throw new PublicationStateError();
      const versionId = randomUUID();
      const bodyMarkdown = normalizeInternalPageLinks(row.body_markdown);
      await client.query(
        `INSERT INTO knowledge_page_versions(
          id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [versionId, pageId, row.version_number + 1, row.current_path, row.title, row.summary, bodyMarkdown, input.commit_message, actor.kind, actor.subject],
      );
      await client.query(
        `UPDATE knowledge_pages SET current_version_id=$2, archived_at=now(),updated_at=now() WHERE id=$1`,
        [pageId, versionId],
      );
      await insertAssetLinks(client, versionId, bodyMarkdown);
      await prunePageVersions(client, pageId);
      return this.getWith(client, pageId);
    });
  }

  async get(pageId: string) {
    const result = await this.pool.query(`${CURRENT_PAGE_SELECT} WHERE p.id = $1`, [pageId]);
    return result.rows[0] ?? null;
  }

  async getByPath(path: string, includeArchived = false) {
    const result = await this.pool.query(
      `${CURRENT_PAGE_SELECT}
       WHERE p.current_path=$1 ${includeArchived ? "" : "AND p.archived_at IS NULL"}
       ORDER BY p.archived_at NULLS FIRST
       LIMIT 1`,
      [path],
    );
    return result.rows[0] ?? null;
  }

  async guidesForPath(targetPath: string) {
    const segments = targetPath.split("/").filter(Boolean);
    const guidePaths = ["agents"];
    for (let depth = 1; depth <= segments.length; depth += 1) {
      guidePaths.push(`${segments.slice(0, depth).join("/")}/agents`);
    }
    const result = await this.pool.query(
      `${CURRENT_PAGE_SELECT}
       WHERE p.current_path=ANY($1::text[]) AND p.archived_at IS NULL
       ORDER BY array_position($1::text[],p.current_path)`,
      [guidePaths],
    );
    return result.rows;
  }

  async metadataInDirectory(directoryPath: string) {
    const result = await this.pool.query(
      `SELECT p.id,p.current_path AS path,v.version_number,v.title,v.summary
       FROM knowledge_pages p
       JOIN knowledge_page_versions v ON v.id=p.current_version_id AND v.page_id=p.id
       WHERE p.parent_path=$1 AND p.archived_at IS NULL
       ORDER BY p.current_path`,
      [directoryPath],
    );
    return result.rows;
  }

  private async getWith(client: PoolClient, pageId: string) {
    const result = await client.query(`${CURRENT_PAGE_SELECT} WHERE p.id = $1`, [pageId]);
    return result.rows[0] ?? null;
  }

  async listMetadata(includeArchived = false, excludeGuides = false) {
    const conditions = [
      includeArchived ? "" : "p.archived_at IS NULL",
      excludeGuides
        ? "p.current_path<>CASE WHEN p.parent_path='' THEN 'agents' ELSE p.parent_path||'/agents' END"
        : "",
    ].filter(Boolean);
    const result = await this.pool.query<PageMetadata>(
      `${CURRENT_PAGE_METADATA_SELECT} ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY p.current_path`,
    );
    return result.rows;
  }

  async searchMetadata(
    query: string,
    options: { limit?: number; includeArchived?: boolean; excludeGuides?: boolean } = {},
  ) {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    const result = await this.pool.query<PageMetadata>(
      `${CURRENT_PAGE_METADATA_SELECT}
       WHERE ${options.includeArchived ? "" : "p.archived_at IS NULL AND "}
         ${options.excludeGuides ? "p.current_path<>CASE WHEN p.parent_path='' THEN 'agents' ELSE p.parent_path||'/agents' END AND " : ""}
         p.search_vector @@ websearch_to_tsquery('english', $1)
       ORDER BY ts_rank(p.search_vector, websearch_to_tsquery('english', $1)) DESC
       LIMIT $2`,
      [query, limit],
    );
    return result.rows;
  }

  async history(pageId: string) {
    const result = await this.pool.query(
      `SELECT id,page_id,version_number,path,title,summary,commit_message,actor_kind,actor_subject,created_at
       FROM knowledge_page_versions WHERE page_id=$1 ORDER BY version_number DESC`,
      [pageId],
    );
    return result.rows;
  }

  async version(pageId: string, versionNumber: number) {
    const result = await this.pool.query(
      `SELECT id,page_id,version_number,path,title,summary,body_markdown,commit_message,
        actor_kind,actor_subject,created_at
       FROM knowledge_page_versions WHERE page_id=$1 AND version_number=$2`,
      [pageId, versionNumber],
    );
    return result.rows[0] ?? null;
  }

  async changesSince(options: {
    cursor?: string;
    pageToken?: string;
    limit?: number;
  } = {}): Promise<KnowledgePageChangeBatch> {
    if (options.cursor && options.pageToken) {
      throw new Error("Provide a cursor or page token, not both");
    }
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
    let after: bigint;
    let through: bigint;
    let position: bigint;
    if (options.pageToken) {
      ({ after, through, position } = parsePageToken(options.pageToken));
    } else {
      after = parseChangeCursor(options.cursor);
      through = await knowledgeChangeWindowHead(this.pool, after);
      position = after;
    }
    const result = await this.pool.query<KnowledgePageChangeRow>(
      `WITH latest_per_page AS (
         SELECT DISTINCT ON (page_id)
           change_sequence,page_id,version_id,version_number,change_kind,path,title,
           commit_message,actor_kind,actor_subject,changed_at
         FROM knowledge_page_changes
         WHERE change_sequence>$1::bigint AND change_sequence<=$2::bigint
         ORDER BY page_id,change_sequence DESC
       )
       SELECT latest.change_sequence::text AS change_sequence,latest.page_id,
         latest.version_id,latest.version_number,
         baseline.version_number AS previous_version_number,latest.change_kind,
         latest.path,latest.title,latest.commit_message,latest.actor_kind,
         latest.actor_subject,latest.changed_at
       FROM latest_per_page latest
       LEFT JOIN LATERAL (
         SELECT prior.version_number
         FROM knowledge_page_changes prior
         WHERE prior.page_id=latest.page_id AND prior.change_sequence<=$1::bigint
         ORDER BY prior.change_sequence DESC
         LIMIT 1
       ) baseline ON true
       WHERE latest.change_sequence>$3::bigint
       ORDER BY latest.change_sequence
       LIMIT $4`,
      [after.toString(), through.toString(), position.toString(), limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const included = result.rows.slice(0, limit);
    const lastPosition = included.length
      ? BigInt(included[included.length - 1]!.change_sequence)
      : position;
    return {
      changes: included.map(pageChange),
      next_cursor: changeCursor(through),
      ...(hasMore ? { next_page_token: pageToken(after, through, lastPosition) } : {}),
      has_more: hasMore,
    };
  }

  async recentChanges(options: {
    before?: string;
    limit?: number;
  } = {}): Promise<KnowledgePageChangeBatch> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const before = options.before ? parseChangeCursor(options.before) : null;
    const result = await this.pool.query<KnowledgePageChangeRow>(
      `WITH cursor_position AS (
         SELECT changed_at,change_sequence
         FROM knowledge_page_changes
         WHERE change_sequence=$1::bigint
       )
       SELECT changes.change_sequence::text AS change_sequence,changes.page_id,
         changes.version_id,changes.version_number,changes.change_kind,changes.path,
         changes.title,changes.commit_message,changes.actor_kind,changes.actor_subject,
         changes.changed_at
       FROM knowledge_page_changes AS changes
       WHERE $1::bigint IS NULL OR (changes.changed_at,changes.change_sequence)<
         (SELECT changed_at,change_sequence FROM cursor_position)
       ORDER BY changes.changed_at DESC,changes.change_sequence DESC
       LIMIT $2`,
      [before?.toString() ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const included = result.rows.slice(0, limit);
    const oldest = included[included.length - 1];
    return {
      changes: included.map(pageChange),
      next_cursor: oldest ? changeCursor(oldest.change_sequence) : options.before ?? changeCursor(0n),
      has_more: hasMore,
    };
  }

}
