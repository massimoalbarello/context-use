import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { DirectoryRepository, PageRepository } from "../src/index.ts";

describe("knowledge discovery repositories", () => {
  test("lists and searches current page metadata without returning bodies", async () => {
    const queries: Array<{ sql: string; parameters: unknown[] | undefined }> = [];
    const pool = {
      async query(sql: string, parameters?: unknown[]) {
        queries.push({ sql, parameters });
        return {
          rowCount: 1,
          rows: [{
            id: "page-id",
            current_path: "about/career",
            current_version_id: "version-id",
            published_version_id: null,
            archived_at: null,
            version_number: 1,
            title: "Career",
            summary: "The owner's career.",
            updated_at: "2026-07-28T12:00:00.000Z",
          }],
        };
      },
    } as unknown as Pool;
    const pages = new PageRepository(pool);

    const listed = await pages.listMetadata();
    const searched = await pages.searchMetadata("career", { limit: 10, includeArchived: true });

    expect(listed[0]).not.toHaveProperty("body_markdown");
    expect(searched[0]).not.toHaveProperty("body_markdown");
    expect(queries[0]?.sql).not.toContain("body_markdown");
    expect(queries[1]?.sql).not.toContain("body_markdown");
    expect(queries[1]?.sql).not.toContain("p.archived_at IS NULL");
    expect(queries[1]?.parameters).toEqual(["career", 10]);
  });

  test("loads root-to-leaf guide candidates for a target path", async () => {
    const calls: unknown[][] = [];
    const pool = {
      async query(_sql: string, parameters: unknown[]) {
        calls.push(parameters);
        return {
          rowCount: 2,
          rows: [
            { current_path: "agents", title: "AGENTS.md" },
            { current_path: "about/tasks/agents", title: "AGENTS.md" },
          ],
        };
      },
    } as unknown as Pool;
    const pages = new PageRepository(pool);

    expect(await pages.guidesForPath("about/tasks/job-search")).toEqual([
      { current_path: "agents", title: "AGENTS.md" },
      { current_path: "about/tasks/agents", title: "AGENTS.md" },
    ]);
    expect(calls).toEqual([[[
      "agents",
      "about/agents",
      "about/tasks/agents",
      "about/tasks/job-search/agents",
    ]]]);
  });

  test("builds a bounded hierarchy while always retaining directory guides", async () => {
    const queries: Array<{ sql: string; parameters: unknown[] }> = [];
    const pool = {
      async query(sql: string, parameters: unknown[]) {
        queries.push({ sql, parameters });
        if (queries.length === 1) {
          return {
            rowCount: 3,
            rows: [
              { id: "directory-about", path: "about", title: "About", summary: "Owner knowledge.", depth: 0 },
              { id: "directory-tasks", path: "about/tasks", title: "Tasks", summary: "Current efforts.", depth: 1 },
              { id: "directory-job", path: "about/tasks/job-search", title: "Job search", summary: "The current search.", depth: 2 },
            ],
          };
        }
        if (queries.length === 2) {
          return {
            rowCount: 2,
            rows: [
              { id: "guide-about", path: "about/agents", version_number: 1, title: "AGENTS.md", summary: "About rules." },
              { id: "guide-job", path: "about/tasks/job-search/agents", version_number: 2, title: "AGENTS.md", summary: "Job-search rules." },
            ],
          };
        }
        return {
          rowCount: 3,
          rows: [
            { id: "page-intro", path: "about/intro", version_number: 1, title: "Introduction", summary: "Owner introduction." },
            { id: "page-current", path: "about/tasks/current", version_number: 1, title: "Current tasks", summary: "Current task list." },
            { id: "page-criteria", path: "about/tasks/job-search/criteria", version_number: 3, title: "Criteria", summary: "Role criteria." },
          ],
        };
      },
    } as unknown as Pool;
    const directories = new DirectoryRepository(pool);

    const tree = await directories.treeByPath("about", 2, 2);

    expect(queries[0]?.parameters).toEqual(["about", 2]);
    expect(queries[2]?.parameters).toEqual([
      ["about", "about/tasks", "about/tasks/job-search"],
      3,
    ]);
    expect(tree).toMatchObject({
      path: "about",
      guide: { path: "about/agents" },
      pages: [{ path: "about/intro" }],
      directories: [{
        path: "about/tasks",
        pages: [{ path: "about/tasks/current" }],
        directories: [{
          path: "about/tasks/job-search",
          guide: { path: "about/tasks/job-search/agents" },
          pages: [],
        }],
      }],
      requested_depth: 2,
      max_pages: 2,
      truncated: true,
    });
  });
});
