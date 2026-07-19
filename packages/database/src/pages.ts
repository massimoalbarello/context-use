import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  Actor,
  ArchiveAutomationPageInput,
  ArchivePageInput,
  CreateAutomationPageInput,
  CreatePageInput,
  UpdateAutomationPageInput,
  UpdatePageInput,
} from "@context-use/shared";
import { extractAssetLinks, normalizeInternalPageLinks } from "./links.ts";

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

export class AutomationContentAccessError extends Error {
  constructor(message = "The automation run cannot write this page") {
    super(message);
    this.name = "AutomationContentAccessError";
  }
}

export function automationKnowledgePath(automationKey: string, relativePath: string): string {
  return `automations/${automationKey}/${relativePath}`;
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
    p.public_slug, p.required_public_slug, p.automation_id, p.archived_at,
    p.created_at, p.updated_at,
    v.version_number, v.title, v.body_markdown
  FROM knowledge_pages p
  JOIN knowledge_page_versions v ON v.id = p.current_version_id AND v.page_id = p.id
`;

export class PageRepository {
  constructor(private readonly pool: Pool) {}

  private async assertNoActiveAutomationClaim(client: PoolClient, actor: Actor): Promise<void> {
    if (actor.kind !== "mcp") return;
    const result = await client.query(
      `SELECT 1 FROM automation_runs
       WHERE claimed_by=$1 AND status='claimed' AND lease_expires_at > now()
       LIMIT 1`,
      [actor.subject],
    );
    if (result.rowCount) {
      throw new AutomationContentAccessError(
        "A client with an active automation claim must use the automation page tools",
      );
    }
  }

  private async claimedAutomation(
    client: PoolClient,
    runId: string,
    claimToken: string,
    clientId: string,
  ): Promise<{ id: string; key: string }> {
    const result = await client.query<{ schedule_id: string; automation_key: string }>(
      `SELECT run.schedule_id,schedule.automation_key
       FROM automation_runs run
       JOIN cron_schedules schedule ON schedule.id=run.schedule_id
       WHERE run.id=$1 AND run.claim_token=$2 AND run.claimed_by=$3
         AND run.status='claimed' AND run.lease_expires_at > now()
       FOR SHARE`,
      [runId, claimToken, clientId],
    );
    if (!result.rowCount) throw new AutomationContentAccessError();
    return { id: result.rows[0]!.schedule_id, key: result.rows[0]!.automation_key };
  }

  async create(input: CreatePageInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      await this.assertNoActiveAutomationClaim(client, actor);
      const pageId = randomUUID();
      const versionId = randomUUID();
      const bodyMarkdown = normalizeInternalPageLinks(input.body_markdown);
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
        [versionId, pageId, input.path, input.title, bodyMarkdown, input.commit_message, actor.kind, actor.subject],
      );
      await insertAssetLinks(client, versionId, bodyMarkdown);
      return this.getWith(client, pageId);
    });
  }

  async createForAutomation(input: CreateAutomationPageInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      const automation = await this.claimedAutomation(client, input.run_id, input.claim_token, actor.subject);
      const path = automationKnowledgePath(automation.key, input.relative_path);
      const pageId = randomUUID();
      const versionId = randomUUID();
      const bodyMarkdown = normalizeInternalPageLinks(input.body_markdown);
      await client.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,automation_id)
         VALUES ($1,$2,$3,$4)`,
        [pageId, path, versionId, automation.id],
      );
      await client.query(
        `INSERT INTO knowledge_page_versions(
          id,page_id,version_number,path,title,body_markdown,
          commit_message,actor_kind,actor_subject
        ) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8)`,
        [versionId, pageId, path, input.title, bodyMarkdown, input.commit_message, actor.kind, actor.subject],
      );
      await insertAssetLinks(client, versionId, bodyMarkdown);
      return this.getWith(client, pageId);
    });
  }

  async update(pageId: string, input: UpdatePageInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      await this.assertNoActiveAutomationClaim(client, actor);
      const current = await client.query<{ version_number: number }>(
        `${CURRENT_PAGE_SELECT} WHERE p.id = $1 AND p.automation_id IS NULL FOR UPDATE OF p`,
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
          id, page_id, version_number, path, title, body_markdown,
          commit_message, actor_kind, actor_subject
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [versionId, pageId, nextVersion, input.path, input.title, bodyMarkdown, input.commit_message, actor.kind, actor.subject],
      );
      await client.query(
        `UPDATE knowledge_pages
         SET current_path = $2, current_version_id = $3, updated_at = now()
         WHERE id = $1`,
        [pageId, input.path, versionId],
      );
      await insertAssetLinks(client, versionId, bodyMarkdown);
      return this.getWith(client, pageId);
    });
  }

  async updateForAutomation(input: UpdateAutomationPageInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      const automation = await this.claimedAutomation(client, input.run_id, input.claim_token, actor.subject);
      const current = await client.query<{ version_number: number }>(
        `${CURRENT_PAGE_SELECT} WHERE p.id=$1 AND p.automation_id=$2 FOR UPDATE OF p`,
        [input.page_id, automation.id],
      );
      if (!current.rowCount) throw new AutomationContentAccessError();
      const currentVersion = current.rows[0]!.version_number;
      if (currentVersion !== input.expected_version_number) throw new VersionConflictError(currentVersion);
      const path = automationKnowledgePath(automation.key, input.relative_path);
      const versionId = randomUUID();
      const bodyMarkdown = normalizeInternalPageLinks(input.body_markdown);
      await client.query(
        `INSERT INTO knowledge_page_versions(
          id,page_id,version_number,path,title,body_markdown,
          commit_message,actor_kind,actor_subject
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [versionId, input.page_id, currentVersion + 1, path, input.title, bodyMarkdown, input.commit_message, actor.kind, actor.subject],
      );
      await client.query(
        `UPDATE knowledge_pages SET current_path=$2,current_version_id=$3,updated_at=now()
         WHERE id=$1`,
        [input.page_id, path, versionId],
      );
      await insertAssetLinks(client, versionId, bodyMarkdown);
      return this.getWith(client, input.page_id);
    });
  }

  async archive(pageId: string, input: ArchivePageInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      await this.assertNoActiveAutomationClaim(client, actor);
      const current = await client.query<{
        version_number: number;
        current_path: string;
        title: string;
        body_markdown: string;
        published_version_id: string | null;
      }>(`${CURRENT_PAGE_SELECT} WHERE p.id = $1 AND p.automation_id IS NULL FOR UPDATE OF p`, [pageId]);
      if (!current.rowCount) return null;
      const row = current.rows[0]!;
      if (row.version_number !== input.expected_version_number) throw new VersionConflictError(row.version_number);
      if (row.published_version_id) throw new PublicationStateError();
      const versionId = randomUUID();
      const bodyMarkdown = normalizeInternalPageLinks(row.body_markdown);
      await client.query(
        `INSERT INTO knowledge_page_versions(
          id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [versionId, pageId, row.version_number + 1, row.current_path, row.title, bodyMarkdown, input.commit_message, actor.kind, actor.subject],
      );
      await client.query(
        `UPDATE knowledge_pages SET current_version_id=$2, archived_at=now(),updated_at=now() WHERE id=$1`,
        [pageId, versionId],
      );
      await insertAssetLinks(client, versionId, bodyMarkdown);
      return this.getWith(client, pageId);
    });
  }

  async archiveForAutomation(input: ArchiveAutomationPageInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      const automation = await this.claimedAutomation(client, input.run_id, input.claim_token, actor.subject);
      const current = await client.query<{
        version_number: number;
        current_path: string;
        title: string;
        body_markdown: string;
        published_version_id: string | null;
      }>(`${CURRENT_PAGE_SELECT} WHERE p.id=$1 AND p.automation_id=$2 FOR UPDATE OF p`, [input.page_id, automation.id]);
      if (!current.rowCount) throw new AutomationContentAccessError();
      const row = current.rows[0]!;
      if (row.version_number !== input.expected_version_number) throw new VersionConflictError(row.version_number);
      if (row.published_version_id) throw new PublicationStateError();
      const versionId = randomUUID();
      const bodyMarkdown = normalizeInternalPageLinks(row.body_markdown);
      await client.query(
        `INSERT INTO knowledge_page_versions(
          id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [versionId, input.page_id, row.version_number + 1, row.current_path, row.title, bodyMarkdown, input.commit_message, actor.kind, actor.subject],
      );
      await client.query(
        `UPDATE knowledge_pages SET current_version_id=$2,archived_at=now(),updated_at=now() WHERE id=$1`,
        [input.page_id, versionId],
      );
      await insertAssetLinks(client, versionId, bodyMarkdown);
      return this.getWith(client, input.page_id);
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

}
