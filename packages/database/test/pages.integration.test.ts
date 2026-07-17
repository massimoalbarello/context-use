import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { PageRepository, VersionConflictError } from "../src/index.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("immutable page history", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const pages = new PageRepository(pool);
  const createdIds: string[] = [];
  const actor = { kind: "dashboard" as const, subject: "integration-test-owner" };

  afterAll(async () => {
    for (const id of createdIds) {
      await pool.query("DELETE FROM knowledge_asset_links WHERE source_version_id IN (SELECT id FROM knowledge_page_versions WHERE page_id=$1)", [id]);
      await pool.query("ALTER TABLE knowledge_pages DISABLE TRIGGER ALL");
      await pool.query("DELETE FROM knowledge_pages WHERE id=$1", [id]);
      await pool.query("ALTER TABLE knowledge_pages ENABLE TRIGGER ALL");
      await pool.query("DELETE FROM knowledge_page_versions WHERE page_id=$1", [id]);
    }
    await pool.end();
  });

  test("create, update, conflict, and archive always preserve immutable versions", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const created = await pages.create({
      path: `tests/${suffix}/page`, title: "Original", body_markdown: "Original body", commit_message: "Create test page",
    }, actor);
    createdIds.push(created.id);
    expect(created.version_number).toBe(1);

    const updated = await pages.update(created.id, {
      path: `tests/${suffix}/renamed`, title: "Updated", body_markdown: "Searchable updated body",
      commit_message: "Rename and update", expected_version_number: 1,
    }, actor);
    expect(updated?.version_number).toBe(2);
    await expect(pages.update(created.id, {
      path: `tests/${suffix}/stale`, title: "Stale", body_markdown: "Stale",
      commit_message: "Stale update", expected_version_number: 1,
    }, actor)).rejects.toBeInstanceOf(VersionConflictError);

    const archived = await pages.archive(created.id, {
      commit_message: "Archive test page", expected_version_number: 2,
    }, actor);
    expect(archived?.version_number).toBe(3);
    expect(archived?.archived_at).not.toBeNull();

    const history = await pages.history(created.id);
    expect(history.map((version) => version.version_number)).toEqual([3, 2, 1]);
    expect(history.map((version) => version.commit_message)).toEqual([
      "Archive test page", "Rename and update", "Create test page",
    ]);
  });
});
