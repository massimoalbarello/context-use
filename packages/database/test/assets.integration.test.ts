import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import {
  AssetRepository,
  DirectoryRepository,
  PageRepository,
} from "../src/index.ts";
import { disposableDatabaseUrl } from "../src/disposable-database.ts";

const databaseUrl = await disposableDatabaseUrl();
const mcpDatabaseUrl = process.env.MCP_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const describeMcpDatabase = databaseUrl && mcpDatabaseUrl ? describe : describe.skip;

describeDatabase("hierarchical asset metadata", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const assets = new AssetRepository(pool);
  const directories = new DirectoryRepository(pool);
  const pages = new PageRepository(pool);
  const createdIds: string[] = [];
  const createdPageIds: string[] = [];
  const createdDirectoryIds: string[] = [];

  afterAll(async () => {
    for (const id of createdPageIds) {
      await pool.query("BEGIN");
      try {
        await pool.query("SET CONSTRAINTS ALL DEFERRED");
        await pool.query(
          `DELETE FROM knowledge_asset_links
           WHERE source_version_id IN (SELECT id FROM knowledge_page_versions WHERE page_id=$1)`,
          [id],
        );
        await pool.query("DELETE FROM knowledge_page_versions WHERE page_id=$1", [id]);
        await pool.query("DELETE FROM knowledge_pages WHERE id=$1", [id]);
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
    }
    for (const id of createdDirectoryIds) {
      await pool.query("DELETE FROM knowledge_directories WHERE id=$1", [id]);
    }
    for (const id of createdIds) await pool.query("DELETE FROM assets WHERE id=$1", [id]);
    await pool.end();
  });

  test("creates and lists an asset at its requested knowledge path", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const created = await assets.create({
      currentPath: `tests/${suffix}/site-photo`,
      filename: "site-photo.jpg",
      contentType: "image/jpeg",
      sizeBytes: 123,
      contentHash: "a".repeat(64),
    });
    createdIds.push(created.id);

    expect(created.current_path).toBe(`tests/${suffix}/site-photo`);
    expect((await assets.get(created.id))?.current_path).toBe(created.current_path);
    expect((await assets.list()).some((asset) => asset.id === created.id && asset.current_path === created.current_path)).toBe(true);
  });

  test("archives only private assets that no active page references while retaining storage metadata", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const directory = await directories.create({
      path: `asset-archive-${suffix}`,
      title: "Asset archive test",
      summary: "Temporary pages used to verify safe asset archival.",
    });
    createdDirectoryIds.push(directory.id);
    const created = await assets.create({
      currentPath: `${directory.current_path}/document`,
      filename: "document.pdf",
      contentType: "application/pdf",
      sizeBytes: 456,
      contentHash: "c".repeat(64),
    });
    createdIds.push(created.id);

    await pool.query("UPDATE assets SET public_path=current_path WHERE id=$1", [created.id]);
    await expect(assets.archive(created.id)).rejects.toMatchObject({
      reason: "published",
    });
    await pool.query("UPDATE assets SET public_path=NULL WHERE id=$1", [created.id]);

    const page = await pages.create({
      path: `${directory.current_path}/page`,
      title: "Asset reference",
      summary: "A temporary active page that references the test asset.",
      body_markdown: `![Document](context-use://asset/${created.id})`,
      commit_message: "Create asset archive test page",
    }, { kind: "dashboard", subject: "asset-archive-test" });
    createdPageIds.push(page.id);
    await expect(assets.archive(created.id)).rejects.toMatchObject({
      reason: "referenced",
    });

    await pages.archive(page.id, {
      commit_message: "Archive asset reference page",
      expected_version_number: page.version_number,
    }, { kind: "dashboard", subject: "asset-archive-test" });
    expect(await assets.archive(created.id)).toMatchObject({
      id: created.id,
      current_path: created.current_path,
      deleted_at: expect.any(Date),
    });
    expect(await assets.get(created.id)).toBeNull();
    expect((await pool.query<{ s3_object_key: string }>(
      "SELECT s3_object_key FROM assets WHERE id=$1",
      [created.id],
    )).rows[0]?.s3_object_key).toBe(`objects/${created.id}`);
  });
});

describeMcpDatabase("MCP asset upload metadata", () => {
  const adminPool = new Pool({ connectionString: databaseUrl });
  const mcpPool = new Pool({ connectionString: mcpDatabaseUrl });
  const assets = new AssetRepository(mcpPool);
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) await adminPool.query("DELETE FROM assets WHERE id=$1", [id]);
    await Promise.all([adminPool.end(), mcpPool.end()]);
  });

  test("creates and archives asset metadata through the narrowly scoped MCP role", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const created = await assets.create({
      currentPath: `tests/mcp-${suffix}/private-document`,
      filename: "private-document.pdf",
      contentType: "application/pdf",
      sizeBytes: 456,
      contentHash: "b".repeat(64),
    });
    createdIds.push(created.id);

    expect(created).toMatchObject({
      current_path: `tests/mcp-${suffix}/private-document`,
      filename: "private-document.pdf",
      content_hash: "b".repeat(64),
    });
    expect(await assets.archive(created.id)).toMatchObject({
      id: created.id,
      deleted_at: expect.any(Date),
    });
    expect(await assets.get(created.id)).toBeNull();
    expect((await adminPool.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM assets WHERE id=$1",
      [created.id],
    )).rows[0]?.deleted_at).toBeInstanceOf(Date);
  });
});
