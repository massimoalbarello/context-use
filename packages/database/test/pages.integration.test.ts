import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import {
  PageRepository,
  VersionConflictError,
} from "../src/index.ts";
import { disposableDatabaseUrl } from "../src/disposable-database.ts";
import { MemoryMarkdownStore } from "./memory-markdown-store.ts";

const databaseUrl = await disposableDatabaseUrl();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("immutable page history", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const pages = new PageRepository(pool, new MemoryMarkdownStore());
  const createdIds: string[] = [];
  const actor = { kind: "dashboard" as const, subject: "integration-test-owner" };

  const createDirectory = async (path: string) => {
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent) await createDirectory(parent);
    await pool.query(
      `INSERT INTO knowledge_directories(id,current_path,title,summary,search_vector)
       VALUES ($1,$2,$3,$4,directory_search_vector($2,$3,$4,''))
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
      await pool.query("DELETE FROM knowledge_page_changes WHERE page_id=$1", [id]);
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
    const afterCreate = (await pages.changesSince({ limit: 500 })).next_cursor;

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
    expect(await pages.getByPath(`tests/${suffix}/renamed`)).toBeNull();
    expect(await pages.getByPath(`tests/${suffix}/renamed`, true)).toMatchObject({
      id: created.id,
      archived_at: expect.any(Date),
    });

    const history = await pages.history(created.id);
    expect(history.map((version) => version.version_number)).toEqual([3, 2, 1]);
    expect(history.map((version) => version.commit_message)).toEqual([
      "Archive test page", "Rename and update", "Create test page",
    ]);
    const changes = await pool.query<{ change_kind: string; version_number: number }>(
      `SELECT change_kind,version_number FROM knowledge_page_changes
       WHERE page_id=$1 ORDER BY change_sequence`,
      [created.id],
    );
    expect(changes.rows).toEqual([
      { change_kind: "created", version_number: 1 },
      { change_kind: "updated", version_number: 2 },
      { change_kind: "archived", version_number: 3 },
    ]);
    const incremental = await pages.changesSince({ limit: 500 });
    expect(incremental.changes.filter(({ page_id }) => page_id === created.id)).toEqual([
      expect.objectContaining({
        change_kind: "archived",
        version_number: 3,
        path: `tests/${suffix}/renamed`,
      }),
    ]);
    expect(incremental.next_cursor).toMatch(/^cu-page-changes-v1\.[0-9a-z]+$/);
    const sinceCreate = await pages.changesSince({ cursor: afterCreate, limit: 500 });
    expect(sinceCreate.changes.filter(({ page_id }) => page_id === created.id)).toEqual([
      expect.objectContaining({
        change_kind: "archived",
        version_number: 3,
        previous_version_number: 1,
      }),
    ]);
  });

  test("retains every application revision and searches only current content", async () => {
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
    for (let index = 0; index < 7; index += 1) {
      const updated = await pages.update(created.id, {
        path: created.current_path,
        title: "Retention test",
        summary: "A page used to test version retention.",
        body_markdown: index === 6 ? currentSearchTerm : `Intermediate ${index}`,
        commit_message: `Update retention ${index}`,
        expected_version_number: versionNumber,
      }, actor);
      versionNumber = updated!.version_number;
    }

    expect((await pages.history(created.id)).map(({ version_number }) => version_number)).toEqual([
      8, 7, 6, 5, 4, 3, 2, 1,
    ]);
    expect((await pages.searchMetadata(oldSearchTerm)).some(({ id }) => id === created.id)).toBe(false);
    const searchResults = await pages.searchMetadata(currentSearchTerm);
    expect(searchResults.some(({ id }) => id === created.id)).toBe(true);
    expect(searchResults.find(({ id }) => id === created.id)).not.toHaveProperty("body_markdown");

    await pool.query(
      "UPDATE knowledge_pages SET published_version_id=NULL,public_path=NULL WHERE id=$1",
      [created.id],
    );
    await pages.update(created.id, {
      path: created.current_path,
      title: "Retention test",
      summary: "A page used to test version retention.",
      body_markdown: currentSearchTerm,
      commit_message: "Retain former publication",
      expected_version_number: versionNumber,
    }, actor);
    expect((await pages.history(created.id)).map(({ version_number }) => version_number)).toEqual([
      9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
    expect((await pool.query(
      "SELECT 1 FROM knowledge_page_changes WHERE page_id=$1",
      [created.id],
    )).rowCount).toBe(9);
  });

  test("a scan cutoff cannot skip a lower sequence that commits late", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    await createDirectory(`tests/${suffix}`);
    const previousCursor = (await pages.changesSince({ limit: 500 })).next_cursor;
    const firstPageId = crypto.randomUUID();
    const firstVersionId = crypto.randomUUID();
    const secondPageId = crypto.randomUUID();
    const secondVersionId = crypto.randomUUID();
    createdIds.push(firstPageId, secondPageId);
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      await first.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,search_vector)
         VALUES ($1,$2,$3,page_search_vector($2,'First','The first concurrent page.','Body'))`,
        [firstPageId, `tests/${suffix}/first`, firstVersionId],
      );
      await first.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,
           commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,$3,'First','The first concurrent page.','Body',
           'Create first concurrent page','dashboard','integration-test-owner')`,
        [firstVersionId, firstPageId, `tests/${suffix}/first`],
      );

      await second.query("BEGIN");
      const secondPid = (await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      await second.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,search_vector)
         VALUES ($1,$2,$3,page_search_vector($2,'Second','The second concurrent page.','Body'))`,
        [secondPageId, `tests/${suffix}/second`, secondVersionId],
      );
      const secondVersion = second.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,
           commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,$3,'Second','The second concurrent page.','Body',
           'Create second concurrent page','dashboard','integration-test-owner')`,
        [secondVersionId, secondPageId, `tests/${suffix}/second`],
      );
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await pool.query<{ wait_event_type: string | null }>(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [secondPid],
        );
        if (activity.rows[0]?.wait_event_type === "Lock") break;
        await Bun.sleep(2);
      }

      const scan = pages.changesSince({ cursor: previousCursor, limit: 10 });
      await first.query("COMMIT");
      await secondVersion;
      await second.query("COMMIT");

      const changedPageIds = (await scan).changes.map(({ page_id }) => page_id);
      expect(changedPageIds).toEqual(expect.arrayContaining([firstPageId, secondPageId]));
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await second.query("ROLLBACK").catch(() => undefined);
      first.release();
      second.release();
    }
  });
});
