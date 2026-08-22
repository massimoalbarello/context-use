import type { Pool } from "pg";

export type DocumentLinkIndex = {
  source_revision_id: string;
  links_indexed_at: Date | string | null;
  target_document_ids: string[];
};

export type DocumentBacklink = {
  source_document_id: string;
  source_revision_id: string;
  source_revision_number: number;
  source_authority: "source" | "knowledge";
  source_representation: "markdown" | "asset";
  links_indexed_at: Date | string;
};

export type DocumentBacklinkPage = {
  backlinks: DocumentBacklink[];
  has_more: boolean;
};

/**
 * Revision-scoped derived graph access. Markdown remains authoritative: callers
 * replace the complete extracted target set, including an empty set.
 */
export class DocumentLinkRepository {
  constructor(private readonly pool: Pool) {}

  async replaceRevisionTargets(
    sourceRevisionId: string,
    targetDocumentIds: string[],
  ): Promise<DocumentLinkIndex> {
    await this.pool.query(
      "SELECT replace_document_links($1,$2::uuid[])",
      [sourceRevisionId, targetDocumentIds],
    );
    return (await this.revisionIndex(sourceRevisionId))!;
  }

  async revisionIndex(sourceRevisionId: string): Promise<DocumentLinkIndex | null> {
    const result = await this.pool.query<DocumentLinkIndex>(
      `SELECT revision.id AS source_revision_id,revision.links_indexed_at,
         coalesce(
           array_agg(link.target_document_id ORDER BY link.target_document_id)
             FILTER (WHERE link.target_document_id IS NOT NULL),
           '{}'::uuid[]
         ) AS target_document_ids
       FROM hypermedia_document_revisions revision
       LEFT JOIN document_links link ON link.source_revision_id=revision.id
       WHERE revision.id=$1
       GROUP BY revision.id,revision.links_indexed_at`,
      [sourceRevisionId],
    );
    return result.rows[0] ?? null;
  }

  async backlinks(
    targetDocumentId: string,
    limit = 100,
  ): Promise<DocumentBacklinkPage> {
    const boundedLimit = Number.isFinite(limit)
      ? Math.min(Math.max(Math.floor(limit), 1), 500)
      : 100;
    const result = await this.pool.query<DocumentBacklink>(
      `SELECT revision.document_id AS source_document_id,
         revision.id AS source_revision_id,
         revision.revision_number AS source_revision_number,
         document.authority AS source_authority,
         document.representation AS source_representation,
         revision.links_indexed_at
       FROM document_links link
       JOIN hypermedia_document_revisions revision
         ON revision.id=link.source_revision_id
       JOIN hypermedia_documents document ON document.id=revision.document_id
       JOIN (
         SELECT page.id AS document_id,page.current_version_id AS revision_id
         FROM knowledge_pages page
         WHERE page.archived_at IS NULL
         UNION ALL
         SELECT record.document_id,record.current_revision_id
         FROM source_records record
         WHERE record.deleted_at IS NULL AND record.current_revision_id IS NOT NULL
       ) current_source
         ON current_source.document_id=revision.document_id
        AND current_source.revision_id=revision.id
       WHERE link.target_document_id=$1
       ORDER BY revision.created_at DESC,revision.id DESC
       LIMIT $2`,
      [targetDocumentId, boundedLimit + 1],
    );
    return {
      backlinks: result.rows.slice(0, boundedLimit),
      has_more: result.rows.length > boundedLimit,
    };
  }

  /**
   * A backlink result can be complete only after every live current Markdown
   * revision has been indexed: any unindexed body could still link to any
   * target. This is deliberately global and conservative rather than inferred
   * from the number of backlinks returned for one target.
   */
  async backlinksComplete(): Promise<boolean> {
    const result = await this.pool.query<{ backlinks_complete: boolean }>(
      `SELECT NOT EXISTS (
         SELECT 1
         FROM (
           SELECT page.id AS document_id,page.current_version_id AS revision_id
           FROM knowledge_pages page
           WHERE page.archived_at IS NULL
           UNION ALL
           SELECT record.document_id,record.current_revision_id
           FROM source_records record
           WHERE record.deleted_at IS NULL AND record.current_revision_id IS NOT NULL
         ) current_source
         LEFT JOIN hypermedia_document_revisions revision
           ON revision.document_id=current_source.document_id
          AND revision.id=current_source.revision_id
         WHERE revision.id IS NULL OR revision.links_indexed_at IS NULL
       ) AS backlinks_complete`,
    );
    return result.rows[0]?.backlinks_complete === true;
  }
}
