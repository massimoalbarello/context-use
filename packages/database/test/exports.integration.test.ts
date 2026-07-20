import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { AssetRepository, ConfirmationRepository, KnowledgeExportRepository, PageRepository } from "../src/index.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("passkey-bound current knowledge exports", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const pages = new PageRepository(pool);
  const assets = new AssetRepository(pool);
  const exports = new KnowledgeExportRepository(pool);
  const confirmations = new ConfirmationRepository(pool);
  const actor = { kind: "dashboard" as const, subject: "knowledge-export-test" };
  let fixtureRoot = "";
  let fixtureIntentId = "";

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO "user"(id,name,email,"emailVerified")
       VALUES ('context-use-owner','Owner','owner@example.com',true)`,
    );
    await pool.query(
      `INSERT INTO passkey(id,"publicKey","userId","credentialID",counter,"deviceType","backedUp")
       VALUES ('export-test-passkey','public-key','context-use-owner','verified-credential',0,'multiDevice',true)`,
    );
  });

  afterAll(async () => {
    // Repository methods intentionally own their transactions. Clean the
    // committed fixture with trigger/FK enforcement suspended only on this
    // superuser test connection so the immutable production rows stay
    // undeletable to every application role.
    await pool.query("BEGIN");
    try {
      await pool.query("SET LOCAL session_replication_role=replica");
      if (fixtureIntentId) {
        await pool.query("DELETE FROM confirmation_challenges WHERE intent_id=$1", [fixtureIntentId]);
        await pool.query("DELETE FROM knowledge_export_intents WHERE id=$1", [fixtureIntentId]);
      }
      if (fixtureRoot) {
        await pool.query(
          `DELETE FROM knowledge_asset_links
           WHERE source_version_id IN (
             SELECT version.id FROM knowledge_page_versions version
             JOIN knowledge_pages page ON page.id=version.page_id
             WHERE page.current_path LIKE $1
           ) OR target_asset_id IN (
             SELECT id FROM assets WHERE current_path LIKE $1
           )`,
          [`${fixtureRoot}/%`],
        );
        await pool.query(
          `DELETE FROM knowledge_page_versions WHERE page_id IN (
             SELECT id FROM knowledge_pages WHERE current_path LIKE $1
           )`,
          [`${fixtureRoot}/%`],
        );
        await pool.query("DELETE FROM knowledge_pages WHERE current_path LIKE $1", [`${fixtureRoot}/%`]);
        await pool.query("DELETE FROM assets WHERE current_path LIKE $1", [`${fixtureRoot}/%`]);
      }
      await pool.query("DELETE FROM passkey WHERE id='export-test-passkey'");
      await pool.query("DELETE FROM \"user\" WHERE id='context-use-owner'");
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
    await pool.end();
  });

  test("exports active knowledge as of download and permits one same-session claim", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    fixtureRoot = `tests/export-${suffix}`;
    const active = await pages.create({
      path: `${fixtureRoot}/active`,
      title: "Active export page",
      body_markdown: "Latest active body",
      commit_message: "Create active export fixture",
    }, actor);
    const archived = await pages.create({
      path: `${fixtureRoot}/archived`,
      title: "Archived export page",
      body_markdown: "Archived body",
      commit_message: "Create archived export fixture",
    }, actor);
    await pages.archive(archived.id, {
      expected_version_number: 1,
      commit_message: "Archive export fixture",
    }, actor);
    const asset = await assets.create({
      currentPath: `${fixtureRoot}/asset`,
      filename: "friendly.pdf",
      contentType: "application/pdf",
      sizeBytes: 123,
      contentHash: "a".repeat(64),
    });

    const principal = { ownerUserId: "context-use-owner", sessionId: `session-${suffix}` };
    const intent = await exports.createIntent(principal);
    fixtureIntentId = intent.id;
    await confirmations.issueChallenge("knowledge_export", intent.id, randomBytes(32).toString("base64url"));
    expect(intent.page_count).toBeGreaterThanOrEqual(1);
    expect(intent.asset_count).toBeGreaterThanOrEqual(1);
    await expect(confirmations.claimExport(intent.id, principal)).rejects.toThrow();
    await expect(confirmations.confirmExport(intent.id, { ...principal, sessionId: "wrong-session" }, {
      credentialId: "verified-credential", expectedCounter: 0, newCounter: 0,
    })).rejects.toThrow();
    await confirmations.confirmExport(intent.id, principal, {
      credentialId: "verified-credential", expectedCounter: 0, newCounter: 0,
    });
    await expect(confirmations.claimExport(intent.id, { ...principal, sessionId: "wrong-session" })).rejects.toThrow();

    await pages.update(active.id, {
      path: `${fixtureRoot}/active`,
      title: "Active export page",
      body_markdown: "Current body at download",
      commit_message: "Update after export authorization",
      expected_version_number: 1,
    }, actor);

    await confirmations.claimExport(intent.id, principal);
    const snapshot = await exports.currentSnapshot();
    expect(snapshot.pages.find(({ id }) => id === active.id)?.body_markdown).toBe("Current body at download");
    expect(snapshot.pages.some(({ id }) => id === archived.id)).toBe(false);
    expect(snapshot.assets.find(({ id }) => id === asset.id)).toMatchObject({
      filename: "friendly.pdf",
      current_path: `${fixtureRoot}/asset`,
    });
    expect(await exports.getIntent(intent.id)).toMatchObject({ download_started_at: expect.any(Date) });
    await expect(confirmations.claimExport(intent.id, principal)).rejects.toThrow();
  });
});
