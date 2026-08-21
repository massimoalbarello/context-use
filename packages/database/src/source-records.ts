import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  markdownObjectMetadata,
  type MarkdownObjectMetadata,
  type MarkdownObjectStore,
} from "./documents.ts";

export type SourceRecordWrite = {
  integration: string;
  connectionId: string;
  model: string;
  sourceRecordId: string;
  action: "added" | "updated" | "deleted";
  sourceCreatedAt?: string | null;
  sourceUpdatedAt: string;
  markdown: string | null;
};

export interface SourceRecordWriter {
  write(record: SourceRecordWrite): Promise<void>;
}

type CurrentSourceRecord = {
  document_id: string;
  current_revision_id: string | null;
  revision_number: number | null;
  body_content_hash: string | null;
  source_updated_at: Date;
  deleted_at: Date | null;
};

const CURRENT_SOURCE_RECORD = `
  SELECT source.document_id,source.current_revision_id,
    revision.revision_number,revision.body_content_hash,
    source.source_updated_at,source.deleted_at
  FROM source_records source
  LEFT JOIN hypermedia_document_revisions revision
    ON revision.id=source.current_revision_id
   AND revision.document_id=source.document_id
  WHERE source.integration=$1 AND source.connection_id=$2
    AND source.model=$3 AND source.source_record_id=$4
`;

function identity(record: SourceRecordWrite): [string, string, string, string] {
  return [record.integration, record.connectionId, record.model, record.sourceRecordId];
}

function lockIdentity(record: SourceRecordWrite): string {
  return identity(record).map((value) => `${value.length}:${value}`).join("|");
}

function isSuperseded(record: SourceRecordWrite, current: CurrentSourceRecord): boolean {
  const currentTime = current.source_updated_at.getTime();
  const incomingTime = new Date(record.sourceUpdatedAt).getTime();
  return currentTime > incomingTime
    || (currentTime === incomingTime && current.deleted_at !== null && record.action !== "deleted");
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
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

export class SourceRecordRepository implements SourceRecordWriter {
  constructor(
    private readonly pool: Pool,
    private readonly bodies: MarkdownObjectStore,
  ) {}

  async write(record: SourceRecordWrite): Promise<void> {
    if (record.action !== "deleted" && record.markdown === null) {
      throw new Error("Active source record is missing Markdown");
    }
    const revisionId = randomUUID();
    const candidate = record.markdown === null
      ? null
      : markdownObjectMetadata(revisionId, record.markdown);
    const initial = await this.pool.query<CurrentSourceRecord>(
      CURRENT_SOURCE_RECORD,
      identity(record),
    );
    if (initial.rows[0] && isSuperseded(record, initial.rows[0])) return;

    let stored: MarkdownObjectMetadata | null = null;
    if (candidate && initial.rows[0]?.body_content_hash !== candidate.body_content_hash) {
      stored = await this.bodies.write(revisionId, record.markdown!);
    }

    await transaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [lockIdentity(record)],
      );
      const selected = await client.query<CurrentSourceRecord>(
        `${CURRENT_SOURCE_RECORD} FOR UPDATE OF source`,
        identity(record),
      );
      const current = selected.rows[0];
      if (current && isSuperseded(record, current)) return;

      const documentId = current?.document_id ?? randomUUID();
      await client.query(
        `INSERT INTO hypermedia_documents(id,authority)
         VALUES ($1,'source') ON CONFLICT (id) DO NOTHING`,
        [documentId],
      );

      let currentRevisionId = current?.current_revision_id ?? null;
      if (candidate && current?.body_content_hash !== candidate.body_content_hash) {
        // The preflight normally writes before taking the database lock. This
        // fallback covers the rare case where another writer changed the row
        // between those two operations.
        if (!stored) stored = await this.bodies.write(revisionId, record.markdown!);
        const next = await client.query<{ revision_number: number }>(
          `SELECT coalesce(max(revision_number),0)+1 AS revision_number
           FROM hypermedia_document_revisions WHERE document_id=$1`,
          [documentId],
        );
        await client.query(
          `INSERT INTO hypermedia_document_revisions(
             id,document_id,revision_number,body_object_key,body_size_bytes,
             body_content_hash
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [revisionId, documentId, next.rows[0]!.revision_number,
            stored.body_object_key, stored.body_size_bytes, stored.body_content_hash],
        );
        currentRevisionId = revisionId;
      }

      if (record.action === "deleted") {
        await client.query(
          `INSERT INTO source_records(
             document_id,current_revision_id,integration,connection_id,model,
             source_record_id,source_created_at,source_updated_at,search_vector,
             deleted_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,
             to_tsvector('english',coalesce($9,'')),$8
           )
           ON CONFLICT (integration,connection_id,model,source_record_id)
           DO UPDATE SET
             current_revision_id=coalesce(
               EXCLUDED.current_revision_id,source_records.current_revision_id
             ),
             source_created_at=coalesce(
               source_records.source_created_at,EXCLUDED.source_created_at
             ),
             source_updated_at=EXCLUDED.source_updated_at,
             search_vector=CASE WHEN $9::text IS NULL
               THEN source_records.search_vector ELSE EXCLUDED.search_vector END,
             deleted_at=EXCLUDED.deleted_at`,
          [documentId, currentRevisionId, record.integration,
            record.connectionId, record.model, record.sourceRecordId,
            record.sourceCreatedAt ?? null, record.sourceUpdatedAt,
            record.markdown],
        );
        await client.query(
          "UPDATE hypermedia_documents SET updated_at=now() WHERE id=$1",
          [documentId],
        );
        return;
      }

      await client.query(
        `INSERT INTO source_records(
           document_id,current_revision_id,integration,connection_id,model,
           source_record_id,source_created_at,source_updated_at,search_vector
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_tsvector('english',$9))
         ON CONFLICT (integration,connection_id,model,source_record_id)
         DO UPDATE SET current_revision_id=EXCLUDED.current_revision_id,
           source_created_at=coalesce(source_records.source_created_at,EXCLUDED.source_created_at),
           source_updated_at=EXCLUDED.source_updated_at,
           search_vector=EXCLUDED.search_vector,deleted_at=NULL`,
        [documentId, currentRevisionId, record.integration, record.connectionId,
          record.model, record.sourceRecordId, record.sourceCreatedAt ?? null,
          record.sourceUpdatedAt, record.markdown!],
      );
      await client.query(
        "UPDATE hypermedia_documents SET updated_at=now() WHERE id=$1",
        [documentId],
      );
    });
  }
}
