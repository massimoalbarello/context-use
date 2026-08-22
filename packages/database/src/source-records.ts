import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  assertMarkdownObject,
  markdownObjectMetadata,
  MAX_MARKDOWN_DOCUMENT_BYTES,
  type MarkdownObjectMetadata,
  type MarkdownObjectStore,
} from "./documents.ts";
import {
  extractDocumentLinks,
  MAX_DOCUMENT_LINKS_PER_REVISION,
} from "./links.ts";

export type SourceRecordWrite = {
  integration: string;
  connectionInstanceId: number;
  connectionId: string;
  model: string;
  sourceRecordId: string;
  action: "added" | "updated" | "deleted";
  sourceCreatedAt?: string | null;
  sourceUpdatedAt: string;
  markdown: string | null;
};

export type SourceRecordIdentity = {
  document_id: string;
  current_revision_id: string | null;
  reference: string;
};

export type SourceRecordMetadata = SourceRecordIdentity & {
  authority: "source";
  revision_number: number | null;
  integration: string;
  connection_instance_id: number | null;
  connection_id: string;
  model: string;
  source_record_id: string;
  source_created_at: Date | null;
  source_updated_at: Date;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type SourceRecordDocument = SourceRecordMetadata & {
  body_markdown: string | null;
};

export interface SourceRecordWriter {
  write(record: SourceRecordWrite): Promise<SourceRecordIdentity>;
}

type CurrentSourceRecord = {
  document_id: string;
  current_revision_id: string | null;
  revision_number: number | null;
  body_content_hash: string | null;
  source_updated_at: Date;
  deleted_at: Date | null;
  authority: "source" | "knowledge";
  connection_id: string;
};

const CURRENT_SOURCE_RECORD = `
  SELECT source.document_id,source.current_revision_id,
    revision.revision_number,revision.body_content_hash,
    source.source_updated_at,source.deleted_at,document.authority,
    source.connection_id
  FROM source_records source
  JOIN hypermedia_documents document ON document.id=source.document_id
  LEFT JOIN hypermedia_document_revisions revision
    ON revision.id=source.current_revision_id
   AND revision.document_id=source.document_id
  WHERE source.integration=$1 AND source.connection_instance_id=$2
    AND source.model=$3 AND source.source_record_id=$4
`;

const SOURCE_RECORD_FROM = `
  FROM source_records source
  JOIN hypermedia_documents document
    ON document.id=source.document_id AND document.authority='source'
  LEFT JOIN hypermedia_document_revisions revision
    ON revision.id=source.current_revision_id
   AND revision.document_id=source.document_id
`;

const SOURCE_RECORD_METADATA_COLUMNS = `
  source.document_id,source.current_revision_id,
  revision.revision_number,document.authority,
  source.integration,source.connection_instance_id::text AS connection_instance_id,
  source.connection_id,source.model,source.source_record_id,
  source.source_created_at,source.source_updated_at,source.deleted_at,
  document.created_at,document.updated_at
`;

const SOURCE_RECORD_METADATA_SELECT = `
  SELECT ${SOURCE_RECORD_METADATA_COLUMNS}
  ${SOURCE_RECORD_FROM}
`;

const SOURCE_RECORD_DOCUMENT_SELECT = `
  SELECT ${SOURCE_RECORD_METADATA_COLUMNS},
    revision.body_object_key,revision.body_size_bytes,revision.body_content_hash
  ${SOURCE_RECORD_FROM}
`;

type SourceRecordMetadataRow = Omit<
  SourceRecordMetadata,
  "reference" | "connection_instance_id"
> & {
  connection_instance_id: string | null;
};

type SourceRecordDocumentRow = SourceRecordMetadataRow & {
  body_object_key: string | null;
  body_size_bytes: number | null;
  body_content_hash: string | null;
};

const SOURCE_RECORD_SEARCH_CHUNK_BYTES = 64 * 1024;
// PostgreSQL tokenizes each tsvector independently. Overlap enough source
// bytes that an indexable lexeme straddling a byte boundary still appears
// whole in at least one chunk (PostgreSQL lexemes are themselves bounded).
const SOURCE_RECORD_SEARCH_CHUNK_OVERLAP_BYTES = 4 * 1024;

function sourceRecordSearchChunks(markdown: string): string[] {
  const bytes = Buffer.from(markdown, "utf8");
  const chunks: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let end = Math.min(offset + SOURCE_RECORD_SEARCH_CHUNK_BYTES, bytes.length);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    chunks.push(bytes.subarray(offset, end).toString("utf8"));
    if (end === bytes.length) break;
    offset = end - SOURCE_RECORD_SEARCH_CHUNK_OVERLAP_BYTES;
    while (offset < end && (bytes[offset]! & 0xc0) === 0x80) offset += 1;
  }
  return chunks;
}

function sourceRecordIdentity(
  record: Pick<CurrentSourceRecord, "document_id" | "current_revision_id">,
): SourceRecordIdentity {
  return {
    document_id: record.document_id,
    current_revision_id: record.current_revision_id,
    reference: `context-use://document/${record.document_id}`,
  };
}

function withReference<T extends SourceRecordMetadataRow>(
  record: T,
): SourceRecordMetadata {
  return {
    ...record,
    connection_instance_id: record.connection_instance_id === null
      ? null
      : Number(record.connection_instance_id),
    reference: `context-use://document/${record.document_id}`,
  };
}

function assertSourceAuthority(record: CurrentSourceRecord): void {
  if (record.authority !== "source") {
    throw new Error("Source record points to a non-source document");
  }
}

function identity(record: SourceRecordWrite): [string, number, string, string] {
  return [
    record.integration,
    record.connectionInstanceId,
    record.model,
    record.sourceRecordId,
  ];
}

function lockIdentity(record: SourceRecordWrite): string {
  return identity(record).map((value) => {
    const encoded = String(value);
    return `${typeof value}:${encoded.length}:${encoded}`;
  }).join("|");
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

  private async withBody(row: SourceRecordDocumentRow | undefined): Promise<SourceRecordDocument | null> {
    if (!row) return null;
    const {
      body_object_key,
      body_size_bytes,
      body_content_hash,
      ...metadata
    } = row;
    const record = withReference(metadata);
    if (record.current_revision_id === null) {
      return { ...record, body_markdown: null };
    }
    if (body_object_key === null || body_size_bytes === null || body_content_hash === null) {
      throw new Error("Source record current revision is missing object metadata");
    }
    const object = { body_object_key, body_size_bytes, body_content_hash };
    const markdown = await this.bodies.read(object);
    return {
      ...record,
      body_markdown: assertMarkdownObject(markdown, object),
    };
  }

  async get(documentId: string): Promise<SourceRecordDocument | null> {
    const result = await this.pool.query<SourceRecordDocumentRow>(
      `${SOURCE_RECORD_DOCUMENT_SELECT} WHERE source.document_id=$1`,
      [documentId],
    );
    return this.withBody(result.rows[0]);
  }

  async metadata(documentId: string): Promise<SourceRecordMetadata | null> {
    const result = await this.pool.query<SourceRecordMetadataRow>(
      `${SOURCE_RECORD_METADATA_SELECT} WHERE source.document_id=$1`,
      [documentId],
    );
    return result.rows[0] ? withReference(result.rows[0]) : null;
  }

  async searchMetadata(
    query: string,
    options: { limit?: number } = {},
  ): Promise<SourceRecordMetadata[]> {
    if (!query.trim()) return [];
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    const result = await this.pool.query<SourceRecordMetadataRow>(
      `WITH query AS (
         SELECT plainto_tsquery('english',$1) AS value,
           tsvector_to_array(to_tsvector('english',$1)) AS terms
       ), candidate_scores AS (
         SELECT source.document_id,
           ts_rank(source.search_vector,query.value) AS rank
         FROM source_records source
         CROSS JOIN query
         WHERE source.search_vector @@ query.value
         UNION ALL
         SELECT chunk.document_id,
           max(ts_rank(chunk.search_vector,query.value)) AS rank
         FROM source_record_search_chunks chunk
         CROSS JOIN query
         WHERE chunk.search_vector @@ query.value
         GROUP BY chunk.document_id
         UNION ALL
         SELECT chunk.document_id,0::real AS rank
         FROM query
         CROSS JOIN LATERAL unnest(query.terms) AS expected(term)
         JOIN source_record_search_chunks chunk
           ON chunk.search_vector @@ plainto_tsquery('english',expected.term)
         WHERE cardinality(query.terms)>0
         GROUP BY chunk.document_id
         HAVING count(DISTINCT expected.term)=(SELECT cardinality(terms) FROM query)
       ), candidates AS (
         SELECT document_id,max(rank) AS rank
         FROM candidate_scores
         GROUP BY document_id
       )
       SELECT ${SOURCE_RECORD_METADATA_COLUMNS}
       ${SOURCE_RECORD_FROM}
       JOIN candidates ON candidates.document_id=source.document_id
       ORDER BY candidates.rank DESC,
         source.source_updated_at DESC,source.document_id
       LIMIT $2`,
      [query, limit],
    );
    return result.rows.map(withReference);
  }

  async write(record: SourceRecordWrite): Promise<SourceRecordIdentity> {
    if (!Number.isSafeInteger(record.connectionInstanceId) || record.connectionInstanceId < 1) {
      throw new Error("Nango connection instance ID must be a positive safe integer");
    }
    if (record.action !== "deleted" && record.markdown === null) {
      throw new Error("Active source record is missing Markdown");
    }
    const revisionId = randomUUID();
    const candidate = record.markdown === null
      ? null
      : markdownObjectMetadata(revisionId, record.markdown);
    if (candidate && candidate.body_size_bytes > MAX_MARKDOWN_DOCUMENT_BYTES) {
      throw new Error("Source record Markdown exceeds the document size limit");
    }
    const initial = await this.pool.query<CurrentSourceRecord>(
      CURRENT_SOURCE_RECORD,
      identity(record),
    );
    if (initial.rows[0]) {
      assertSourceAuthority(initial.rows[0]);
      if (
        isSuperseded(record, initial.rows[0])
        && initial.rows[0].connection_id === record.connectionId
      ) {
        return sourceRecordIdentity(initial.rows[0]);
      }
    }

    let stored: MarkdownObjectMetadata | null = null;
    let extractedLinks: string[] | null = null;
    const currentDocumentLinks = (): string[] => {
      if (record.markdown === null) return [];
      extractedLinks ??= extractDocumentLinks(record.markdown);
      return extractedLinks;
    };
    if (candidate && initial.rows[0]?.body_content_hash !== candidate.body_content_hash) {
      stored = await this.bodies.write(revisionId, record.markdown!);
      currentDocumentLinks();
    }

    return transaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [lockIdentity(record)],
      );
      const selected = await client.query<CurrentSourceRecord>(
        `${CURRENT_SOURCE_RECORD} FOR UPDATE OF source`,
        identity(record),
      );
      const current = selected.rows[0];
      if (current) {
        assertSourceAuthority(current);
        if (isSuperseded(record, current)) {
          if (current.connection_id !== record.connectionId) {
            await client.query(
              "UPDATE source_records SET connection_id=$2 WHERE document_id=$1",
              [current.document_id, record.connectionId],
            );
          }
          return sourceRecordIdentity(current);
        }
      }
      const bodyChanged = candidate !== null
        && current?.body_content_hash !== candidate.body_content_hash;

      const documentId = current?.document_id ?? randomUUID();
      await client.query(
        `INSERT INTO hypermedia_documents(id,authority)
         VALUES ($1,'source') ON CONFLICT (id) DO NOTHING`,
        [documentId],
      );

      let currentRevisionId = current?.current_revision_id ?? null;
      if (bodyChanged) {
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
        const targetDocumentIds = currentDocumentLinks();
        if (targetDocumentIds.length <= MAX_DOCUMENT_LINKS_PER_REVISION) {
          await client.query(
            "SELECT replace_document_links($1,$2::uuid[])",
            [revisionId, targetDocumentIds],
          );
        }
        currentRevisionId = revisionId;
      }

      if (record.action === "deleted") {
        await client.query(
          `INSERT INTO source_records(
             document_id,current_revision_id,integration,connection_instance_id,
             connection_id,model,source_record_id,source_created_at,
             source_updated_at,search_vector,deleted_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,
             ''::tsvector,$9
           )
           ON CONFLICT (
             integration,connection_instance_id,model,source_record_id
           ) WHERE connection_instance_id IS NOT NULL
           DO UPDATE SET
             connection_id=EXCLUDED.connection_id,
             current_revision_id=coalesce(
               EXCLUDED.current_revision_id,source_records.current_revision_id
             ),
             source_created_at=coalesce(
               source_records.source_created_at,EXCLUDED.source_created_at
             ),
             source_updated_at=EXCLUDED.source_updated_at,
             search_vector=CASE WHEN $10::text IS NULL
               THEN source_records.search_vector ELSE ''::tsvector END,
             deleted_at=EXCLUDED.deleted_at`,
          [documentId, currentRevisionId, record.integration,
            record.connectionInstanceId, record.connectionId, record.model,
            record.sourceRecordId, record.sourceCreatedAt ?? null, record.sourceUpdatedAt,
            record.markdown],
        );
        if (bodyChanged) {
          await client.query(
            "SELECT replace_source_record_search_chunks($1,$2::text[])",
            [documentId, sourceRecordSearchChunks(record.markdown!)],
          );
        }
        await client.query(
          "UPDATE hypermedia_documents SET updated_at=now() WHERE id=$1",
          [documentId],
        );
        return sourceRecordIdentity({
          document_id: documentId,
          current_revision_id: currentRevisionId,
        });
      }

      await client.query(
        `INSERT INTO source_records(
           document_id,current_revision_id,integration,connection_instance_id,
           connection_id,model,source_record_id,source_created_at,
           source_updated_at,search_vector
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,''::tsvector)
         ON CONFLICT (
           integration,connection_instance_id,model,source_record_id
         ) WHERE connection_instance_id IS NOT NULL
         DO UPDATE SET connection_id=EXCLUDED.connection_id,
           current_revision_id=EXCLUDED.current_revision_id,
           source_created_at=coalesce(source_records.source_created_at,EXCLUDED.source_created_at),
           source_updated_at=EXCLUDED.source_updated_at,
           search_vector=EXCLUDED.search_vector,deleted_at=NULL`,
        [documentId, currentRevisionId, record.integration,
          record.connectionInstanceId, record.connectionId, record.model,
          record.sourceRecordId, record.sourceCreatedAt ?? null,
          record.sourceUpdatedAt],
      );
      if (bodyChanged) {
        await client.query(
          "SELECT replace_source_record_search_chunks($1,$2::text[])",
          [documentId, sourceRecordSearchChunks(record.markdown!)],
        );
      }
      await client.query(
        "UPDATE hypermedia_documents SET updated_at=now() WHERE id=$1",
        [documentId],
      );
      return sourceRecordIdentity({
        document_id: documentId,
        current_revision_id: currentRevisionId,
      });
    });
  }
}
