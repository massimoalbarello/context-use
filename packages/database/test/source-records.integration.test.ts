import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import {
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
      connectionId,
      model: "GithubIssue",
      sourceRecordId: "issue-42",
      sourceCreatedAt: "2026-08-20T08:00:00.000Z",
    };
    try {
      await records.write({
        ...base,
        action: "added",
        sourceUpdatedAt: "2026-08-20T08:00:00.000Z",
        markdown: "# Issue 42\n\nOpen.\n",
      });
      await records.write({
        ...base,
        action: "updated",
        sourceUpdatedAt: "2026-08-20T09:00:00.000Z",
        markdown: "# Issue 42\n\nOpen.\n",
      });
      await records.write({
        ...base,
        action: "updated",
        sourceUpdatedAt: "2026-08-20T10:00:00.000Z",
        markdown: "# Issue 42\n\nClosed.\n",
      });

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

      await records.write({
        ...base,
        action: "updated",
        sourceUpdatedAt: "2026-08-20T09:30:00.000Z",
        markdown: "# Issue 42\n\nStale re-open.\n",
      });
      expect((await pool.query(
        "SELECT 1 FROM hypermedia_document_revisions WHERE document_id=$1",
        [source.rows[0]!.document_id],
      )).rowCount).toBe(2);
      expect(store.bodies.size).toBe(2);

      await records.write({
        ...base,
        action: "deleted",
        sourceUpdatedAt: "2026-08-20T11:00:00.000Z",
        markdown: null,
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

      await records.write({
        ...base,
        action: "added",
        sourceUpdatedAt: "2026-08-20T12:00:00.000Z",
        markdown: "# Issue 42\n\nClosed.\n",
      });
      expect((await pool.query<{ deleted: boolean }>(
        "SELECT deleted_at IS NOT NULL AS deleted FROM source_records WHERE connection_id=$1",
        [connectionId],
      )).rows[0]?.deleted).toBe(false);

      await records.write({
        ...base,
        sourceRecordId: "unknown-deletion",
        action: "deleted",
        sourceUpdatedAt: "2026-08-20T13:00:00.000Z",
        markdown: null,
      });
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
    } finally {
      await pool.query(
        `DELETE FROM hypermedia_documents
         WHERE id IN (SELECT document_id FROM source_records WHERE connection_id=$1)`,
        [connectionId],
      );
    }
  });
});
