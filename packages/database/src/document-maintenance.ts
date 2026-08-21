import type { Pool } from "pg";
import type { MarkdownObjectMetadata } from "./documents.ts";

export type PublishedProjectionPage = MarkdownObjectMetadata & {
  page_id: string;
  version_id: string;
  source_path: string;
  public_path: string;
  title: string;
  summary: string;
  version_created_at: Date | string;
};

export type PublicProjectionSnapshot = {
  generation: number;
  pages: PublishedProjectionPage[];
  pageTargets: Array<{ id: string; source_path: string; public_path: string }>;
  assetTargets: Array<{ id: string; public_path: string }>;
  directoryTargets: Array<{ id: string; path: string }>;
};

export class DocumentMaintenanceRepository {
  constructor(private readonly pool: Pool) {}

  async projectionSnapshot(): Promise<PublicProjectionSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const generation = await client.query<{ generation: string }>(
        "SELECT generation::text FROM public_projection_state WHERE singleton",
      );
      const pages = await client.query<PublishedProjectionPage>(
        `SELECT page.id AS page_id,version.id AS version_id,version.path AS source_path,
           page.public_path,version.title,version.summary,
           version.created_at AS version_created_at,object.body_object_key,
           object.body_size_bytes,object.body_content_hash
         FROM knowledge_pages page
         JOIN knowledge_page_versions version
           ON version.id=page.published_version_id AND version.page_id=page.id
         JOIN hypermedia_document_revisions object ON object.id=version.id
         CROSS JOIN public_projection_state state
         LEFT JOIN published_page_artifacts artifact
           ON artifact.page_id=page.id
          AND artifact.version_id=version.id
          AND artifact.projection_generation=state.generation
         WHERE page.published_version_id IS NOT NULL
           AND page.public_path IS NOT NULL
           AND page.archived_at IS NULL
           AND artifact.page_id IS NULL
         ORDER BY page.public_path`,
      );
      if (!pages.rowCount) {
        await client.query("COMMIT");
        return {
          generation: Number(generation.rows[0]?.generation ?? 1),
          pages: [],
          pageTargets: [],
          assetTargets: [],
          directoryTargets: [],
        };
      }
      const pageTargets = await client.query<{ id: string; source_path: string; public_path: string }>(
        `SELECT page.id,version.path AS source_path,page.public_path
         FROM knowledge_pages page
         JOIN knowledge_page_versions version
           ON version.id=page.published_version_id AND version.page_id=page.id
         WHERE page.published_version_id IS NOT NULL
           AND page.public_path IS NOT NULL
           AND page.archived_at IS NULL`,
      );
      const assetTargets = await client.query<{ id: string; public_path: string }>(
        `SELECT id,public_path FROM assets
         WHERE public_path IS NOT NULL AND deleted_at IS NULL`,
      );
      const directoryTargets = await client.query<{ id: string; path: string }>(
        `SELECT directory.id,directory.current_path AS path
         FROM knowledge_directories directory
         WHERE EXISTS (
           SELECT 1 FROM knowledge_pages page
           JOIN knowledge_page_versions version
             ON version.id=page.published_version_id AND version.page_id=page.id
           WHERE page.published_version_id IS NOT NULL
             AND page.public_path IS NOT NULL
             AND page.archived_at IS NULL
             AND (directory.current_path=''
               OR left(version.path,length(directory.current_path)+1)=directory.current_path||'/')
         )`,
      );
      await client.query("COMMIT");
      return {
        generation: Number(generation.rows[0]?.generation ?? 1),
        pages: pages.rows,
        pageTargets: pageTargets.rows,
        assetTargets: assetTargets.rows,
        directoryTargets: directoryTargets.rows,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordPublishedArtifact(input: {
    pageId: string;
    versionId: string;
    generation: number;
    artifactId: string;
    objectKey: string;
    sizeBytes: number;
    contentHash: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO published_page_artifacts(
         page_id,version_id,projection_generation,artifact_id,body_object_key,
         body_size_bytes,body_content_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (page_id,version_id,projection_generation) DO NOTHING`,
      [input.pageId, input.versionId, input.generation, input.artifactId,
        input.objectKey, input.sizeBytes, input.contentHash],
    );
  }
}
