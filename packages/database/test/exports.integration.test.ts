import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import {
  AssetRepository,
  ConfirmationRepository,
  KnowledgeArchiveRepository,
  KnowledgeExportRepository,
  PageRepository,
} from "../src/index.ts";
import { disposableDatabaseUrl } from "../src/disposable-database.ts";

const databaseUrl = await disposableDatabaseUrl();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("passkey-bound current knowledge exports", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const pages = new PageRepository(pool);
  const assets = new AssetRepository(pool);
  const exports = new KnowledgeExportRepository(pool);
  const archives = new KnowledgeArchiveRepository(pool);
  const confirmations = new ConfirmationRepository(pool);
  const actor = { kind: "dashboard" as const, subject: "knowledge-export-test" };
  let fixtureRoot = "";
  const fixtureIntentIds: string[] = [];
  let createdOwner = false;

  beforeAll(async () => {
    // The owner identity is a singleton, so this suite adopts one that another
    // suite already left behind rather than colliding with it — and records
    // whether it created the row, because teardown must only remove its own.
    const owner = await pool.query(
      `INSERT INTO "user"(id,name,email,"emailVerified")
       VALUES ('context-use-owner','Owner','owner@example.com',true)
       ON CONFLICT (id) DO NOTHING`,
    );
    createdOwner = owner.rowCount === 1;
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
      for (const fixtureIntentId of fixtureIntentIds) {
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
        await pool.query("DELETE FROM knowledge_directories WHERE current_path=$1", [fixtureRoot]);
      }
      await pool.query("DELETE FROM passkey WHERE id='export-test-passkey'");
      if (createdOwner) await pool.query("DELETE FROM \"user\" WHERE id='context-use-owner'");
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
    await pool.end();
  });

  test("exports active knowledge as of download and permits resumable same-session claims", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    fixtureRoot = `tests/export-${suffix}`;
    await pool.query(
      `INSERT INTO knowledge_directories(id,current_path,title,summary,search_vector)
       VALUES
         ($1,'tests','Tests','Integration test knowledge.',directory_search_vector('tests','Tests','Integration test knowledge.','')),
         ($2,$3,'Export fixture','Knowledge used to test exports.',directory_search_vector($3,'Export fixture','Knowledge used to test exports.',''))
       ON CONFLICT (current_path) DO NOTHING`,
      [crypto.randomUUID(), crypto.randomUUID(), fixtureRoot],
    );
    const active = await pages.create({
      path: `${fixtureRoot}/active`,
      title: "Active export page",
      summary: "The active page included in an export.",
      body_markdown: "Latest active body",
      commit_message: "Create active export fixture",
    }, actor);
    const archived = await pages.create({
      path: `${fixtureRoot}/archived`,
      title: "Archived export page",
      summary: "An archived page excluded from an export.",
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
    fixtureIntentIds.push(intent.id);
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
      summary: "The active page included in an export.",
      body_markdown: "Current body at download",
      commit_message: "Update after export authorization",
      expected_version_number: 1,
    }, actor);

    await confirmations.claimExport(intent.id, principal);
    const snapshot = await exports.currentSnapshot();
    expect(snapshot.pages.find(({ id }) => id === active.id)?.body_markdown).toBe("Current body at download");
    expect(snapshot.pages.find(({ id }) => id === active.id)?.summary).toBe("The active page included in an export.");
    expect(snapshot.pages.some(({ id }) => id === archived.id)).toBe(false);
    expect(snapshot.directories.find(({ current_path }) => current_path === fixtureRoot)).toMatchObject({
      title: "Export fixture",
      summary: "Knowledge used to test exports.",
    });
    expect(snapshot.assets.find(({ id }) => id === asset.id)).toMatchObject({
      filename: "friendly.pdf",
      current_path: `${fixtureRoot}/asset`,
    });
    expect(await exports.getIntent(intent.id)).toMatchObject({ download_started_at: expect.any(Date) });
    const confirmedIntent = await exports.getIntent(intent.id);
    expect(new Date(confirmedIntent!.expires_at).getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1_000);
    await confirmations.claimExport(intent.id, principal);

    const fullArchive = await exports.createIntent(principal, "restorable");
    fixtureIntentIds.push(fullArchive.id);
    expect(fullArchive.export_kind).toBe("restorable");
    expect(fullArchive.page_count).toBeGreaterThanOrEqual(intent.page_count + 1);
    expect(await exports.getIntent(fullArchive.id)).toMatchObject({ export_kind: "restorable" });
    const fullSnapshot = await archives.snapshot();
    expect(fullSnapshot.pages.find(({ id }) => id === archived.id)?.archived_at).not.toBeNull();
    expect(fullSnapshot.page_versions.some(({ page_id }) => page_id === archived.id)).toBeTrue();
    expect(fullSnapshot.assets.find(({ id }) => id === asset.id)).toMatchObject({
      s3_object_key: `objects/${asset.id}`,
      size_bytes: "123",
    });
    expect(fullSnapshot.page_changes.some(({ page_id }) => page_id === archived.id)).toBeTrue();
  });
});
