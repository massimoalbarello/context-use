import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import {
  PAGE_VERSION_RETENTION_LIMIT,
  PageRepository,
  VersionConflictError,
} from "../src/index.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("immutable page history", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const pages = new PageRepository(pool);
  const createdIds: string[] = [];
  const actor = { kind: "dashboard" as const, subject: "integration-test-owner" };

  const createDirectory = async (path: string) => {
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent) await createDirectory(parent);
    await pool.query(
      `INSERT INTO knowledge_directories(id,current_path,title,summary,intro_markdown,search_vector)
       VALUES ($1,$2,$3,$4,'',directory_search_vector($2,$3,$4,''))
       ON CONFLICT (current_path) DO NOTHING`,
      [crypto.randomUUID(), path, path.split("/").at(-1), `Test directory for ${path}.`],
    );
  };

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
    await createDirectory(`tests/${suffix}`);
    const linkedPageId = crypto.randomUUID();
    const created = await pages.create({
      path: `tests/${suffix}/page`, title: "Original",
      summary: "The original test page.",
      body_markdown: `[Related](/app/pages/${linkedPageId})`, commit_message: "Create test page",
    }, actor);
    createdIds.push(created.id);
    expect(created.version_number).toBe(1);
    expect(created.body_markdown).toBe(`[Related](context-use://page/${linkedPageId})`);

    const updated = await pages.update(created.id, {
      path: `tests/${suffix}/renamed`, title: "Updated", summary: "The updated test page.", body_markdown: "Searchable updated body",
      commit_message: "Rename and update", expected_version_number: 1,
    }, actor);
    expect(updated?.version_number).toBe(2);
    await expect(pool.query(
      "UPDATE knowledge_pages SET current_path=$2 WHERE id=$1",
      [created.id, `tests/${suffix}/divergent-cache`],
    )).rejects.toThrow();
    expect((await pages.get(created.id))?.current_path).toBe(`tests/${suffix}/renamed`);
    await expect(pages.update(created.id, {
      path: `tests/${suffix}/stale`, title: "Stale", summary: "A stale test update.", body_markdown: "Stale",
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

  test("retains five recent versions plus an older published snapshot and searches only current content", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    await createDirectory(`tests/${suffix}`);
    const oldSearchTerm = `retentionold${suffix}`;
    const currentSearchTerm = `retentioncurrent${suffix}`;
    const created = await pages.create({
      path: `tests/${suffix}/retention`,
      title: "Retention test",
      summary: "A page used to test version retention.",
      body_markdown: oldSearchTerm,
      commit_message: "Create retention test",
    }, actor);
    createdIds.push(created.id);

    await pool.query(
      `UPDATE knowledge_pages
       SET published_version_id=current_version_id,public_path=current_path
       WHERE id=$1`,
      [created.id],
    );

    let versionNumber = created.version_number;
    for (let index = 0; index < PAGE_VERSION_RETENTION_LIMIT + 2; index += 1) {
      const updated = await pages.update(created.id, {
        path: created.current_path,
        title: "Retention test",
        summary: "A page used to test version retention.",
        body_markdown: index === PAGE_VERSION_RETENTION_LIMIT + 1 ? currentSearchTerm : `Intermediate ${index}`,
        commit_message: `Update retention ${index}`,
        expected_version_number: versionNumber,
      }, actor);
      versionNumber = updated!.version_number;
    }

    expect((await pages.history(created.id)).map(({ version_number }) => version_number)).toEqual([
      8, 7, 6, 5, 4, 1,
    ]);
    expect((await pages.search(oldSearchTerm)).some(({ id }) => id === created.id)).toBe(false);
    expect((await pages.search(currentSearchTerm)).some(({ id }) => id === created.id)).toBe(true);

    await pool.query(
      "UPDATE knowledge_pages SET published_version_id=NULL,public_path=NULL WHERE id=$1",
      [created.id],
    );
    await pages.update(created.id, {
      path: created.current_path,
      title: "Retention test",
      summary: "A page used to test version retention.",
      body_markdown: currentSearchTerm,
      commit_message: "Prune former publication",
      expected_version_number: versionNumber,
    }, actor);
    expect((await pages.history(created.id)).map(({ version_number }) => version_number)).toEqual([
      9, 8, 7, 6, 5,
    ]);
  });
});
