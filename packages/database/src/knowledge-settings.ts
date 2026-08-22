import type { Pool } from "pg";

export type KnowledgeSettings = {
  global_guide_document_id: string | null;
  updated_at: Date | string;
};

export type GlobalKnowledgeGuideMetadata = {
  document_id: string;
  current_revision_id: string;
  revision_number: number;
  title: string;
  summary: string;
  body_object_key: string;
  body_size_bytes: number;
  body_content_hash: string;
  settings_updated_at: Date | string;
};

export class KnowledgeSettingsRepository {
  constructor(private readonly pool: Pool) {}

  async get(): Promise<KnowledgeSettings> {
    const result = await this.pool.query<KnowledgeSettings>(
      `SELECT global_guide_document_id,updated_at
       FROM knowledge_settings
       WHERE singleton`,
    );
    const settings = result.rows[0];
    if (!settings) throw new Error("Knowledge settings singleton is missing");
    return settings;
  }

  async globalGuide(): Promise<GlobalKnowledgeGuideMetadata | null> {
    const result = await this.pool.query<GlobalKnowledgeGuideMetadata>(
      `SELECT page.id AS document_id,page.current_version_id AS current_revision_id,
         version.version_number AS revision_number,version.title,version.summary,
         revision.body_object_key,revision.body_size_bytes,revision.body_content_hash,
         settings.updated_at AS settings_updated_at
       FROM knowledge_settings settings
       JOIN knowledge_pages page
         ON page.id=settings.global_guide_document_id AND page.archived_at IS NULL
       JOIN knowledge_page_versions version
         ON version.id=page.current_version_id AND version.page_id=page.id
       JOIN hypermedia_document_revisions revision
         ON revision.id=version.id AND revision.document_id=page.id
       WHERE settings.singleton`,
    );
    const guide = result.rows[0];
    return guide
      ? { ...guide, body_size_bytes: Number(guide.body_size_bytes) }
      : null;
  }

  async updateGlobalGuide(documentId: string): Promise<KnowledgeSettings> {
    const result = await this.pool.query<KnowledgeSettings>(
      `UPDATE knowledge_settings
       SET global_guide_document_id=$1,updated_at=now()
       WHERE singleton
       RETURNING global_guide_document_id,updated_at`,
      [documentId],
    );
    const settings = result.rows[0];
    if (!settings) throw new Error("Knowledge settings singleton is missing");
    return settings;
  }
}
