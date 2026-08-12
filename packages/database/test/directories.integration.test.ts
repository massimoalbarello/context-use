import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import {
  AssetRepository,
  DirectoryRepository,
  DirectoryVersionConflictError,
  PageRepository,
} from "../src/index.ts";
import { disposableDatabaseUrl } from "../src/disposable-database.ts";

const databaseUrl = disposableDatabaseUrl();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("first-class directory indexes", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const directories = new DirectoryRepository(pool);
  const pages = new PageRepository(pool);
  const suffix = crypto.randomUUID().slice(0, 8);
  const parentPath = `tests/directory-${suffix}`;
  const childPath = `${parentPath}/2020-2024_chapters`;
  const grandchildPath = `${childPath}/details`;
  const pageIds: string[] = [];

  afterAll(async () => {
    if (pageIds.length) {
      await pool.query("ALTER TABLE knowledge_pages DISABLE TRIGGER ALL");
      await pool.query("DELETE FROM knowledge_pages WHERE id=ANY($1::uuid[])", [pageIds]);
      await pool.query("ALTER TABLE knowledge_pages ENABLE TRIGGER ALL");
      await pool.query("DELETE FROM knowledge_page_versions WHERE page_id=ANY($1::uuid[])", [pageIds]);
    }
    await pool.query(
      "DELETE FROM knowledge_directories WHERE current_path IN ($1,$2,$3)",
      [grandchildPath, childPath, parentPath],
    );
    await pool.end();
  });

  test("generates a progressive index from direct child summaries", async () => {
    await pool.query(
      `INSERT INTO knowledge_directories(id,current_path,title,summary,search_vector)
       VALUES ($1,'tests','Tests','Integration test knowledge.',directory_search_vector('tests','Tests','Integration test knowledge.',''))
       ON CONFLICT (current_path) DO NOTHING`,
      [crypto.randomUUID()],
    );
    const parent = await directories.create({
      path: parentPath,
      title: "Life",
      summary: "A structured account of the owner's life.",
    });
    const child = await directories.create({
      path: childPath,
      title: "Chapters",
      summary: "The major chapters in the owner's life.",
    });
    const page = await pages.create({
      path: `${parentPath}/1998-2017_intro`,
      title: "Introduction",
      summary: "A concise introduction to this period of the owner's life.",
      body_markdown: "Introduction body.",
      commit_message: "Create directory fixture",
    }, { kind: "dashboard", subject: "integration-test-owner" });
    pageIds.push(page.id);

    expect(await directories.indexByPath(parentPath)).toMatchObject({
      id: parent.id,
      title: "Life",
      children: [
        { kind: "page", id: page.id, title: "Introduction", summary: "A concise introduction to this period of the owner's life.", default_page_id: null },
        { kind: "directory", id: child.id, title: "Chapters", summary: "The major chapters in the owner's life.", default_page_id: null },
      ],
    });
    const childPage = await pages.create({
      path: `${childPath}/como`,
      title: "Como",
      summary: "Growing up at the foot of the Alps.",
      body_markdown: "Como body.",
      commit_message: "Create sole child page",
    }, { kind: "dashboard", subject: "integration-test-owner" });
    pageIds.push(childPage.id);
    const childGuide = await pages.create({
      path: `${childPath}/agents`,
      title: "AGENTS.md",
      summary: "Instructions for maintaining this chapter.",
      body_markdown: "Chapter instructions.",
      commit_message: "Create directory guide fixture",
    }, { kind: "dashboard", subject: "integration-test-owner" });
    pageIds.push(childGuide.id);
    const childIndex = await directories.indexByPath(childPath);
    expect(childIndex?.guide).toMatchObject({ id: childGuide.id, path: `${childPath}/agents` });
    expect(childIndex?.children).not.toContainEqual(expect.objectContaining({ id: childGuide.id }));
    let childEntry = (await directories.indexByPath(parentPath))?.children
      .find(({ id }) => id === child.id);
    expect(childEntry).toMatchObject({
      kind: "directory",
      id: child.id,
      default_page_id: childPage.id,
    });
    const secondChildPage = await pages.create({
      path: `${childPath}/lake`,
      title: "Lake",
      summary: "A second direct page in the chapter.",
      body_markdown: "Lake body.",
      commit_message: "Create second child page",
    }, { kind: "dashboard", subject: "integration-test-owner" });
    pageIds.push(secondChildPage.id);
    childEntry = (await directories.indexByPath(parentPath))?.children
      .find(({ id }) => id === child.id);
    expect(childEntry).toMatchObject({
      kind: "directory",
      id: child.id,
      default_page_id: null,
    });
    await pool.query("UPDATE knowledge_pages SET archived_at=now() WHERE id=$1", [secondChildPage.id]);
    childEntry = (await directories.indexByPath(parentPath))?.children
      .find(({ id }) => id === child.id);
    expect(childEntry).toMatchObject({
      kind: "directory",
      id: child.id,
      default_page_id: childPage.id,
    });

    await directories.create({
      path: grandchildPath,
      title: "Details",
      summary: "Supporting details for the chapter.",
    });
    childEntry = (await directories.indexByPath(parentPath))?.children
      .find(({ id }) => id === child.id);
    expect(childEntry).toMatchObject({
      kind: "directory",
      id: child.id,
      default_page_id: null,
    });
    expect(await directories.hasPublishedDescendant(parentPath)).toBe(false);
    await pool.query(
      "UPDATE knowledge_pages SET published_version_id=current_version_id,public_path=current_path WHERE id=$1",
      [page.id],
    );
    expect(await directories.hasPublishedDescendant("")).toBe(true);
    expect(await directories.hasPublishedDescendant(parentPath)).toBe(true);
    expect(await directories.hasPublishedDescendant(childPath)).toBe(false);
    await pool.query(
      "UPDATE knowledge_pages SET published_version_id=NULL,public_path=NULL WHERE id=$1",
      [page.id],
    );

    const updated = await directories.update(parent.id, {
      title: "A Life",
      summary: "A connected account of the owner's life.",
      expected_version_number: 1,
    });
    expect(updated).toMatchObject({ version_number: 2, title: "A Life" });
    await expect(directories.update(parent.id, {
      title: "Stale",
      summary: "A stale update that must be rejected.",
      expected_version_number: 1,
    })).rejects.toBeInstanceOf(DirectoryVersionConflictError);
  });

  test("requires page parents and directory paths to be unambiguous", async () => {
    await expect(pages.create({
      path: childPath,
      title: "Ambiguous",
      summary: "A page that conflicts with a directory index.",
      body_markdown: "",
      commit_message: "Attempt ambiguous page",
    }, { kind: "dashboard", subject: "integration-test-owner" })).rejects.toThrow();
    await expect(pages.create({
      path: `missing-${suffix}/page`,
      title: "Orphan",
      summary: "A page whose parent directory does not exist.",
      body_markdown: "",
      commit_message: "Attempt orphan page",
    }, { kind: "dashboard", subject: "integration-test-owner" })).rejects.toThrow();
  });
});

describeDatabase("guarded directory deletion", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const directories = new DirectoryRepository(pool);
  const pages = new PageRepository(pool);
  const assets = new AssetRepository(pool);

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO knowledge_directories(id,current_path,title,summary,search_vector)
       VALUES ($1,'tests','Tests','Integration test knowledge.',directory_search_vector('tests','Tests','Integration test knowledge.',''))
       ON CONFLICT (current_path) DO NOTHING`,
      [crypto.randomUUID()],
    );
  });

  test("deletes an empty leaf but never cascades through pages, assets, or child directories", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const parentPath = `tests/delete-directory-${suffix}`;
    const childPath = `${parentPath}/child`;
    const parent = await directories.create({
      path: parentPath,
      title: "Deletion guard",
      summary: "Temporary content for directory deletion tests.",
    });
    const child = await directories.create({
      path: childPath,
      title: "Child",
      summary: "A child directory that prevents cascading deletion.",
    });
    const activePage = await pages.create({
      path: `${parentPath}/active-page`,
      title: "Active page",
      summary: "An active page that prevents directory deletion.",
      body_markdown: "Active.",
      commit_message: "Create active blocker",
    }, { kind: "dashboard", subject: "directory-deletion-test" });
    const archivedPage = await pages.create({
      path: `${parentPath}/archived-page`,
      title: "Archived page",
      summary: "An archived page that still retains version history.",
      body_markdown: "Archived.",
      commit_message: "Create archived blocker",
    }, { kind: "dashboard", subject: "directory-deletion-test" });
    await pages.archive(archivedPage.id, {
      expected_version_number: archivedPage.version_number,
      commit_message: "Archive deletion blocker",
    }, { kind: "dashboard", subject: "directory-deletion-test" });
    const asset = await assets.create({
      currentPath: `${parentPath}/asset`,
      filename: "asset.txt",
      contentType: "text/plain",
      sizeBytes: 1,
      contentHash: "d".repeat(64),
    });

    try {
      await expect(directories.delete(parent.id, {
        expected_version_number: parent.version_number,
      })).rejects.toMatchObject({
        contents: { activePages: 1, archivedPages: 1, assets: 1, directories: 1 },
      });

      expect(await directories.delete(child.id, {
        expected_version_number: child.version_number,
      })).toEqual({ id: child.id, current_path: childPath });
      expect(await directories.get(child.id)).toBeNull();
    } finally {
      await pool.query("BEGIN");
      try {
        await pool.query("SET CONSTRAINTS ALL DEFERRED");
        await pool.query("DELETE FROM knowledge_asset_links WHERE source_version_id IN (SELECT id FROM knowledge_page_versions WHERE page_id=ANY($1::uuid[]))", [[activePage.id, archivedPage.id]]);
        await pool.query("DELETE FROM knowledge_page_versions WHERE page_id=ANY($1::uuid[])", [[activePage.id, archivedPage.id]]);
        await pool.query("DELETE FROM knowledge_pages WHERE id=ANY($1::uuid[])", [[activePage.id, archivedPage.id]]);
        await pool.query("DELETE FROM assets WHERE id=$1", [asset.id]);
        await pool.query("DELETE FROM knowledge_directories WHERE current_path IN ($1,$2)", [childPath, parentPath]);
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
    }
  });

  test("protects the root and rejects a stale directory version", async () => {
    const root = await directories.getByPath("");
    expect(root).not.toBeNull();
    await expect(directories.delete(root!.id, {
      expected_version_number: root!.version_number,
    })).rejects.toMatchObject({ name: "RootDirectoryDeletionError" });

    const suffix = crypto.randomUUID().slice(0, 8);
    const target = await directories.create({
      path: `tests/delete-stale-${suffix}`,
      title: "Stale delete",
      summary: "Temporary content for a stale deletion test.",
    });
    try {
      await expect(directories.delete(target.id, {
        expected_version_number: target.version_number + 1,
      })).rejects.toBeInstanceOf(DirectoryVersionConflictError);
      expect(await directories.get(target.id)).not.toBeNull();
    } finally {
      await pool.query("DELETE FROM knowledge_directories WHERE id=$1", [target.id]);
    }
  });

  test("removes an empty directory with listing metadata", async () => {
    const target = await directories.create({
      path: `tests/delete-empty-${crypto.randomUUID().slice(0, 8)}`,
      title: "Retired feed digest",
      summary: "A retired directory with no remaining content.",
    });
    expect(await directories.delete(target.id, {
      expected_version_number: target.version_number,
    })).toEqual({ id: target.id, current_path: target.current_path });
    expect(await directories.get(target.id)).toBeNull();
  });

  afterAll(async () => {
    await pool.end();
  });
});
