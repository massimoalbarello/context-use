import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import {
  DirectoryRepository,
  DirectoryVersionConflictError,
  PageRepository,
} from "../src/index.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("first-class directory indexes", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const directories = new DirectoryRepository(pool);
  const pages = new PageRepository(pool);
  const suffix = crypto.randomUUID().slice(0, 8);
  const parentPath = `tests/directory-${suffix}`;
  const childPath = `${parentPath}/chapters`;
  let pageId: string | undefined;

  afterAll(async () => {
    if (pageId) {
      await pool.query("ALTER TABLE knowledge_pages DISABLE TRIGGER ALL");
      await pool.query("DELETE FROM knowledge_pages WHERE id=$1", [pageId]);
      await pool.query("ALTER TABLE knowledge_pages ENABLE TRIGGER ALL");
      await pool.query("DELETE FROM knowledge_page_versions WHERE page_id=$1", [pageId]);
    }
    await pool.query("DELETE FROM knowledge_directories WHERE current_path IN ($1,$2)", [childPath, parentPath]);
    await pool.end();
  });

  test("generates a progressive index from direct child summaries", async () => {
    await pool.query(
      `INSERT INTO knowledge_directories(id,current_path,title,summary,intro_markdown,search_vector)
       VALUES ($1,'tests','Tests','Integration test knowledge.','',directory_search_vector('tests','Tests','Integration test knowledge.',''))
       ON CONFLICT (current_path) DO NOTHING`,
      [crypto.randomUUID()],
    );
    const parent = await directories.create({
      path: parentPath,
      title: "Life",
      summary: "A structured account of the owner's life.",
      intro_markdown: "Life only makes sense looking backwards.",
    });
    const child = await directories.create({
      path: childPath,
      title: "Chapters",
      summary: "The major chapters in the owner's life.",
      intro_markdown: "",
    });
    const page = await pages.create({
      path: `${parentPath}/intro`,
      title: "Introduction",
      summary: "A concise introduction to this period of the owner's life.",
      body_markdown: "Introduction body.",
      commit_message: "Create directory fixture",
    }, { kind: "dashboard", subject: "integration-test-owner" });
    pageId = page.id;

    expect(await directories.indexByPath(parentPath)).toMatchObject({
      id: parent.id,
      title: "Life",
      children: [
        { kind: "directory", id: child.id, title: "Chapters", summary: "The major chapters in the owner's life." },
        { kind: "page", id: page.id, title: "Introduction", summary: "A concise introduction to this period of the owner's life." },
      ],
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
      intro_markdown: "Updated introduction.",
      expected_version_number: 1,
    });
    expect(updated).toMatchObject({ version_number: 2, title: "A Life" });
    await expect(directories.update(parent.id, {
      title: "Stale",
      summary: "A stale update that must be rejected.",
      intro_markdown: "",
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
