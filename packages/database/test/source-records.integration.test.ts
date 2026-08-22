import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import {
  DocumentLinkRepository,
  MAX_DOCUMENT_LINKS_PER_REVISION,
  markdownObjectMetadata,
  SourceRecordRepository,
  type MarkdownObjectMetadata,
  type MarkdownObjectStore,
} from "../src/index.ts";
import { disposableDatabaseUrl } from "../src/disposable-database.ts";

const databaseUrl = await disposableDatabaseUrl();
const describeDatabase = databaseUrl ? describe : describe.skip;

class MemoryMarkdownStore implements MarkdownObjectStore {
  readonly bodies = new Map<string, string>();

  async write(revisionId: string, markdown: string): Promise<MarkdownObjectMetadata> {
    const metadata = markdownObjectMetadata(revisionId, markdown);
    this.bodies.set(metadata.body_object_key, markdown);
    return metadata;
  }

  async read(metadata: MarkdownObjectMetadata): Promise<string> {
    const body = this.bodies.get(metadata.body_object_key);
    if (body === undefined) throw new Error("missing body");
    return body;
  }
}

describeDatabase("object-backed source records", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  afterAll(async () => pool.end());

  test("reconciles source-native identity and creates revisions only when Markdown changes", async () => {
    const connectionId = `connection-${crypto.randomUUID()}`;
    const store = new MemoryMarkdownStore();
    const records = new SourceRecordRepository(pool, store);
    const base = {
      integration: "github",
      connectionInstanceId: 101,
      connectionId,
      model: "GithubIssue",
      sourceRecordId: "issue-42",
      sourceCreatedAt: "2026-08-20T08:00:00.000Z",
    };
    try {
      const added = await records.write({
        ...base,
        action: "added",
        sourceUpdatedAt: "2026-08-20T08:00:00.000Z",
        markdown: "# Issue 42\n\nOpen.\n",
      });
      expect(added.reference).toBe(`context-use://document/${added.document_id}`);
      expect(added.current_revision_id).not.toBeNull();
      const initialSearchChunks = await pool.query<{ ctid: string }>(
        `SELECT ctid::text AS ctid FROM source_record_search_chunks
         WHERE document_id=$1 ORDER BY chunk_number`,
        [added.document_id],
      );
      expect(initialSearchChunks.rowCount).toBeGreaterThan(0);

      const replayedBody = await records.write({
        ...base,
        action: "updated",
        sourceUpdatedAt: "2026-08-20T09:00:00.000Z",
        markdown: "# Issue 42\n\nOpen.\n",
      });
      expect(replayedBody).toEqual(added);
      expect((await pool.query<{ ctid: string }>(
        `SELECT ctid::text AS ctid FROM source_record_search_chunks
         WHERE document_id=$1 ORDER BY chunk_number`,
        [added.document_id],
      )).rows).toEqual(initialSearchChunks.rows);

      const changed = await records.write({
        ...base,
        action: "updated",
        sourceUpdatedAt: "2026-08-20T10:00:00.000Z",
        markdown: "# Issue 42\n\nClosed.\n",
      });
      expect(changed.document_id).toBe(added.document_id);
      expect(changed.current_revision_id).not.toBe(added.current_revision_id);
      expect(changed.reference).toBe(added.reference);

      const source = await pool.query<{
        document_id: string;
        deleted_at: Date | null;
        source_updated_at: Date;
      }>(
        "SELECT document_id,deleted_at,source_updated_at FROM source_records WHERE connection_id=$1",
        [connectionId],
      );
      expect(source.rowCount).toBe(1);
      expect(source.rows[0]?.deleted_at).toBeNull();
      expect(source.rows[0]?.source_updated_at.toISOString()).toBe("2026-08-20T10:00:00.000Z");
      expect((await pool.query(
        "SELECT 1 FROM hypermedia_document_revisions WHERE document_id=$1",
        [source.rows[0]!.document_id],
      )).rowCount).toBe(2);
      expect([...store.bodies.values()]).toContain("# Issue 42\n\nClosed.\n");

      const superseded = await records.write({
        ...base,
        action: "updated",
        sourceUpdatedAt: "2026-08-20T09:30:00.000Z",
        markdown: "# Issue 42\n\nStale re-open.\n",
      });
      expect(superseded).toEqual(changed);
      expect((await pool.query(
        "SELECT 1 FROM hypermedia_document_revisions WHERE document_id=$1",
        [source.rows[0]!.document_id],
      )).rowCount).toBe(2);
      expect(store.bodies.size).toBe(2);

      const deleted = await records.write({
        ...base,
        action: "deleted",
        sourceUpdatedAt: "2026-08-20T11:00:00.000Z",
        markdown: null,
      });
      expect(deleted).toEqual(changed);
      expect(await records.get(deleted.document_id)).toMatchObject({
        ...deleted,
        authority: "source",
        revision_number: 2,
        integration: "github",
        connection_instance_id: 101,
        connection_id: connectionId,
        model: "GithubIssue",
        source_record_id: "issue-42",
        deleted_at: new Date("2026-08-20T11:00:00.000Z"),
        body_markdown: "# Issue 42\n\nClosed.\n",
      });
      expect(await records.searchMetadata("Closed")).toEqual([
        expect.objectContaining({
          ...deleted,
          authority: "source",
          deleted_at: new Date("2026-08-20T11:00:00.000Z"),
        }),
      ]);
      expect(await records.metadata(deleted.document_id)).toMatchObject({
        ...deleted,
        authority: "source",
        deleted_at: new Date("2026-08-20T11:00:00.000Z"),
      });
      await records.write({
        ...base,
        action: "updated",
        sourceUpdatedAt: "2026-08-20T10:30:00.000Z",
        markdown: "# Issue 42\n\nClosed.\n",
      });
      expect((await pool.query<{ deleted: boolean }>(
        "SELECT deleted_at IS NOT NULL AS deleted FROM source_records WHERE connection_id=$1",
        [connectionId],
      )).rows[0]?.deleted).toBe(true);

      const restored = await records.write({
        ...base,
        action: "added",
        sourceUpdatedAt: "2026-08-20T12:00:00.000Z",
        markdown: "# Issue 42\n\nClosed.\n",
      });
      expect(restored).toEqual(changed);
      expect((await pool.query<{ deleted: boolean }>(
        "SELECT deleted_at IS NOT NULL AS deleted FROM source_records WHERE connection_id=$1",
        [connectionId],
      )).rows[0]?.deleted).toBe(false);

      const unknownDeletion = await records.write({
        ...base,
        sourceRecordId: "unknown-deletion",
        action: "deleted",
        sourceUpdatedAt: "2026-08-20T13:00:00.000Z",
        markdown: null,
      });
      expect(unknownDeletion.current_revision_id).toBeNull();
      expect(unknownDeletion.reference).toBe(
        `context-use://document/${unknownDeletion.document_id}`,
      );
      const tombstone = await pool.query<{ document_id: string; current_revision_id: string | null }>(
        `SELECT document_id,current_revision_id FROM source_records
         WHERE connection_id=$1 AND source_record_id='unknown-deletion'`,
        [connectionId],
      );
      expect(tombstone.rows[0]?.current_revision_id).toBeNull();
      expect((await pool.query(
        "SELECT 1 FROM hypermedia_document_revisions WHERE document_id=$1",
        [tombstone.rows[0]!.document_id],
      )).rowCount).toBe(0);
      expect(await records.get(unknownDeletion.document_id)).toMatchObject({
        ...unknownDeletion,
        authority: "source",
        source_record_id: "unknown-deletion",
        deleted_at: new Date("2026-08-20T13:00:00.000Z"),
        body_markdown: null,
      });
      expect(await records.get(crypto.randomUUID())).toBeNull();
    } finally {
      await pool.query(
        `DELETE FROM hypermedia_documents
         WHERE id IN (SELECT document_id FROM source_records WHERE connection_id=$1)`,
        [connectionId],
      );
    }
  });

  test("isolates a re-created Nango connection from legacy and prior stream identities", async () => {
    const connectionId = `reused-connection-${crypto.randomUUID()}`;
    const sourceRecordId = `reused-record-${crypto.randomUUID()}`;
    const legacyDocumentId = crypto.randomUUID();
    const store = new MemoryMarkdownStore();
    const records = new SourceRecordRepository(pool, store);
    const base = {
      integration: "github",
      connectionId,
      model: "GithubIssue",
      sourceRecordId,
      sourceCreatedAt: "2026-08-20T08:00:00.000Z",
    };
    try {
      await pool.query(
        "INSERT INTO hypermedia_documents(id,authority) VALUES ($1,'source')",
        [legacyDocumentId],
      );
      await pool.query(
        `INSERT INTO source_records(
           document_id,integration,connection_id,model,source_record_id,
           source_updated_at,search_vector
         ) VALUES ($1,$2,$3,$4,$5,$6,''::tsvector)`,
        [legacyDocumentId, base.integration, connectionId, base.model,
          sourceRecordId, "2026-08-20T09:00:00.000Z"],
      );

      const original = await records.write({
        ...base,
        connectionInstanceId: 701,
        action: "added",
        sourceUpdatedAt: "2026-08-20T10:00:00.000Z",
        markdown: "# Reused issue\n\nOriginal connection.\n",
      });
      const reconnected = await records.write({
        ...base,
        connectionInstanceId: 702,
        action: "added",
        sourceUpdatedAt: "2026-08-20T10:00:00.000Z",
        markdown: "# Reused issue\n\nRe-created connection.\n",
      });

      expect(reconnected.document_id).not.toBe(original.document_id);
      expect(original.document_id).not.toBe(legacyDocumentId);
      expect(reconnected.document_id).not.toBe(legacyDocumentId);
      expect(await records.metadata(original.document_id)).toMatchObject({
        connection_instance_id: 701,
        connection_id: connectionId,
      });
      expect(await records.metadata(reconnected.document_id)).toMatchObject({
        connection_instance_id: 702,
        connection_id: connectionId,
      });

      await records.write({
        ...base,
        connectionInstanceId: 702,
        action: "deleted",
        sourceUpdatedAt: "2026-08-20T11:00:00.000Z",
        markdown: null,
      });
      const streams = await pool.query<{
        document_id: string;
        connection_instance_id: string | null;
        deleted: boolean;
      }>(
        `SELECT document_id,connection_instance_id::text,
           deleted_at IS NOT NULL AS deleted
         FROM source_records
         WHERE integration=$1 AND model=$2 AND source_record_id=$3
         ORDER BY connection_instance_id NULLS FIRST`,
        [base.integration, base.model, sourceRecordId],
      );
      expect(streams.rows).toEqual([
        { document_id: legacyDocumentId, connection_instance_id: null, deleted: false },
        { document_id: original.document_id, connection_instance_id: "701", deleted: false },
        { document_id: reconnected.document_id, connection_instance_id: "702", deleted: true },
      ]);
    } finally {
      await pool.query(
        `DELETE FROM hypermedia_documents
         WHERE id IN (
           SELECT document_id FROM source_records
           WHERE integration=$1 AND model=$2 AND source_record_id=$3
         )`,
        [base.integration, base.model, sourceRecordId],
      );
    }
  });

  test("indexes a varied raw record above four megabytes without building one oversized tsvector", async () => {
    const connectionId = `large-connection-${crypto.randomUUID()}`;
    const store = new MemoryMarkdownStore();
    const records = new SourceRecordRepository(pool, store);
    const crossingTerm = "crosschunkneedle";
    const opening = "boundaryfirstneedle ";
    const crossingTarget = 64 * 1024 - Math.floor(crossingTerm.length / 2);
    const paddingBytes = crossingTarget - opening.length
      - ((crossingTarget - opening.length) % 2);
    const boundaryPrefix = `${opening}${"p ".repeat(paddingBytes / 2)}`;
    expect(Buffer.byteLength(boundaryPrefix, "utf8")).toBeLessThan(64 * 1024);
    expect(Buffer.byteLength(`${boundaryPrefix}${crossingTerm}`, "utf8"))
      .toBeGreaterThan(64 * 1024);
    const markdown = `${boundaryPrefix}${crossingTerm} ${Array.from(
      { length: 450_000 },
      (_, index) => `distinctterm${index.toString(36)}`,
    ).join(" ")} finalsearchneedle`;
    expect(Buffer.byteLength(markdown, "utf8")).toBeGreaterThan(4_000_000);
    try {
      const written = await records.write({
        integration: "agent-conversations",
        connectionInstanceId: 202,
        connectionId,
        model: "AgentConversation",
        sourceRecordId: "large-varied-record",
        action: "added",
        sourceCreatedAt: "2026-08-20T08:00:00.000Z",
        sourceUpdatedAt: "2026-08-20T09:00:00.000Z",
        markdown,
      });

      expect(await records.searchMetadata(
        `boundaryfirstneedle ${crossingTerm} finalsearchneedle`,
      ))
        .toEqual([expect.objectContaining({ document_id: written.document_id })]);
      expect((await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM source_record_search_chunks WHERE document_id=$1`,
        [written.document_id],
      )).rows[0]!.count).toBeGreaterThan(1);
      expect((await records.get(written.document_id))?.body_markdown).toBe(markdown);
    } finally {
      await pool.query(
        `DELETE FROM hypermedia_documents
         WHERE id IN (SELECT document_id FROM source_records WHERE connection_id=$1)`,
        [connectionId],
      );
    }
  });

  test("persists raw records whose derived document-link set exceeds the index cap", async () => {
    const connectionId = `link-heavy-connection-${crypto.randomUUID()}`;
    const store = new MemoryMarkdownStore();
    const records = new SourceRecordRepository(pool, store);
    const links = new DocumentLinkRepository(pool);
    const markdown = Array.from(
      { length: MAX_DOCUMENT_LINKS_PER_REVISION + 1 },
      (_, index) => {
        const suffix = index.toString(16).padStart(12, "0");
        return `[Reference ${index}](context-use://document/00000000-0000-4000-8000-${suffix})`;
      },
    ).join("\n");
    try {
      const written = await records.write({
        integration: "agent-conversations",
        connectionInstanceId: 303,
        connectionId,
        model: "AgentConversation",
        sourceRecordId: "link-heavy-record",
        action: "added",
        sourceCreatedAt: "2026-08-20T08:00:00.000Z",
        sourceUpdatedAt: "2026-08-20T09:00:00.000Z",
        markdown,
      });

      expect((await records.get(written.document_id))?.body_markdown).toBe(markdown);
      expect(await links.revisionIndex(written.current_revision_id!)).toMatchObject({
        source_revision_id: written.current_revision_id,
        links_indexed_at: null,
        target_document_ids: [],
      });
      expect(await links.backlinksComplete()).toBe(false);
    } finally {
      await pool.query(
        `DELETE FROM hypermedia_documents
         WHERE id IN (SELECT document_id FROM source_records WHERE connection_id=$1)`,
        [connectionId],
      );
    }
  });
});
