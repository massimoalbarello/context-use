import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { AssetRepository, KnowledgeExportRepository, PageRepository } from "../src/index.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("passkey-bound knowledge export snapshots", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const pages = new PageRepository(pool);
  const assets = new AssetRepository(pool);
  const exports = new KnowledgeExportRepository(pool, pool);
  const pageIds: string[] = [];
  const assetIds: string[] = [];
  const actor = { kind: "dashboard" as const, subject: "knowledge-export-test" };

  afterAll(async () => {
    await pool.query("DELETE FROM knowledge_export_intents WHERE owner_user_id='export-test-owner'");
    for (const id of assetIds) await pool.query("DELETE FROM assets WHERE id=$1", [id]);
    for (const id of pageIds) {
      await pool.query("DELETE FROM knowledge_asset_links WHERE source_version_id IN (SELECT id FROM knowledge_page_versions WHERE page_id=$1)", [id]);
      await pool.query("ALTER TABLE knowledge_pages DISABLE TRIGGER ALL");
      await pool.query("DELETE FROM knowledge_pages WHERE id=$1", [id]);
      await pool.query("ALTER TABLE knowledge_pages ENABLE TRIGGER ALL");
      await pool.query("DELETE FROM knowledge_page_versions WHERE page_id=$1", [id]);
    }
    await pool.end();
  });

  test("snapshots only active current knowledge and permits one same-session claimed download", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const active = await pages.create({
      path: `tests/export-${suffix}/active`,
      title: "Active export page",
      body_markdown: "Latest active body",
      commit_message: "Create active export fixture",
    }, actor);
    pageIds.push(active.id);
    const archived = await pages.create({
      path: `tests/export-${suffix}/archived`,
      title: "Archived export page",
      body_markdown: "Archived body",
      commit_message: "Create archived export fixture",
    }, actor);
    pageIds.push(archived.id);
    await pages.archive(archived.id, {
      expected_version_number: 1,
      commit_message: "Archive export fixture",
    }, actor);
    const asset = await assets.create({
      currentPath: `tests/export-${suffix}/asset`,
      filename: "friendly.pdf",
      contentType: "application/pdf",
      sizeBytes: 123,
      contentHash: "a".repeat(64),
    });
    assetIds.push(asset.id);

    const principal = { ownerUserId: "export-test-owner", sessionId: `session-${suffix}` };
    const intent = await exports.createIntent(principal, `challenge-${suffix}`);
    expect(intent.page_count).toBeGreaterThanOrEqual(1);
    expect(intent.asset_count).toBeGreaterThanOrEqual(1);
    await expect(exports.claim(intent.id, principal)).rejects.toThrow();
    await expect(exports.confirm(intent.id, { ...principal, sessionId: "wrong-session" }, "credential")).rejects.toThrow();
    await exports.confirm(intent.id, principal, "verified-credential");
    await expect(exports.claim(intent.id, { ...principal, sessionId: "wrong-session" })).rejects.toThrow();

    const snapshot = await exports.claim(intent.id, principal);
    expect(snapshot.pages.find(({ id }) => id === active.id)?.body_markdown).toBe("Latest active body");
    expect(snapshot.pages.some(({ id }) => id === archived.id)).toBe(false);
    expect(snapshot.assets.find(({ id }) => id === asset.id)).toMatchObject({
      filename: "friendly.pdf",
      current_path: `tests/export-${suffix}/asset`,
    });
    expect(await exports.getIntent(intent.id)).toBeNull();
    await expect(exports.claim(intent.id, principal)).rejects.toThrow();
  });
});
