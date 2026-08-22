import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { MarkdownObjectStore } from "./documents.ts";
import type { KnowledgeTemplateBaseline } from "./knowledge-templates.ts";

export type KnowledgeResetPrincipal = { ownerUserId: string; sessionId: string };

export type ClearedKnowledgeCounts = {
  directories: number;
  pages: number;
  page_versions: number;
  assets: number;
  asset_links: number;
  page_changes: number;
};

export type ClearableKnowledgeSummary = {
  page_count: number;
  archived_page_count: number;
  directory_count: number;
  asset_count: number;
  published_page_count: number;
  published_asset_count: number;
};

export class KnowledgeResetRepository {
  constructor(
    private readonly dashboardPool: Pool,
    private readonly bodies: MarkdownObjectStore,
  ) {}

  // Everything the warning has to be honest about before the owner commits.
  async summary(): Promise<ClearableKnowledgeSummary> {
    const result = await this.dashboardPool.query<Record<keyof ClearableKnowledgeSummary, string>>(
      `SELECT
         (SELECT count(*)::text FROM knowledge_pages WHERE archived_at IS NULL) AS page_count,
         (SELECT count(*)::text FROM knowledge_pages WHERE archived_at IS NOT NULL) AS archived_page_count,
         (SELECT count(*)::text FROM knowledge_directories) AS directory_count,
         (SELECT count(*)::text FROM assets WHERE deleted_at IS NULL) AS asset_count,
         (SELECT count(*)::text FROM knowledge_pages WHERE published_version_id IS NOT NULL) AS published_page_count,
         (SELECT count(*)::text FROM assets WHERE public_path IS NOT NULL) AS published_asset_count`,
    );
    const row = result.rows[0]!;
    return {
      page_count: Number(row.page_count),
      archived_page_count: Number(row.archived_page_count),
      directory_count: Number(row.directory_count),
      asset_count: Number(row.asset_count),
      published_page_count: Number(row.published_page_count),
      published_asset_count: Number(row.published_asset_count),
    };
  }

  // Object keys are read before the rows disappear so the storage bytes behind
  // the cleared assets can be removed afterwards.
  async assetObjectKeys(): Promise<string[]> {
    const result = await this.dashboardPool.query<{ s3_object_key: string }>(
      "SELECT s3_object_key FROM assets ORDER BY s3_object_key",
    );
    return result.rows.map(({ s3_object_key }) => s3_object_key);
  }

  async clear(
    intentId: string,
    principal: KnowledgeResetPrincipal,
    baseline: KnowledgeTemplateBaseline,
  ): Promise<ClearedKnowledgeCounts> {
    const revisionId = randomUUID();
    const object = await this.bodies.write(revisionId, baseline.root_guide.body_markdown);
    const search = await this.dashboardPool.query<{ value: string }>(
      `SELECT page_search_vector($1,$2,$3,$4)::text AS value`,
      ["agents", baseline.root_guide.title, baseline.root_guide.summary,
        baseline.root_guide.body_markdown],
    );
    const result = await this.dashboardPool.query<{ result: ClearedKnowledgeCounts }>(
      "SELECT clear_knowledge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS result",
      [
        intentId,
        principal.ownerUserId,
        principal.sessionId,
        revisionId,
        object.body_object_key,
        object.body_size_bytes,
        object.body_content_hash,
        baseline.root_directory.title,
        baseline.root_directory.summary,
        baseline.root_guide.title,
        baseline.root_guide.summary,
        search.rows[0]!.value,
        baseline.root_guide.commit_message,
        baseline.root_guide.actor_subject,
      ],
    );
    return result.rows[0]!.result;
  }
}
