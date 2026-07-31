import { describe, expect, test } from "bun:test";
import type { TemplateRepositories } from "./knowledge-templates.ts";
import { formatTemplateResult, reconcileKnowledgeTemplate } from "./knowledge-templates.ts";

function repositories(options: {
  directories?: string[];
  pages?: Record<string, { body: string; actor: string; archived?: boolean }>;
} = {}) {
  const directoryPaths = new Set(options.directories ?? [""]);
  const pages = new Map(Object.entries(options.pages ?? {}).map(([path, page], index) => [path, {
    id: `page-${index}`,
    current_path: path,
    version_number: 1,
    title: "AGENTS.md",
    summary: path === "agents"
      ? "The global instructions for maintaining this knowledge base."
      : `Instructions for maintaining knowledge in ${path.replace(/\/agents$/, "")}/.`,
    body_markdown: page.body,
    archived_at: page.archived ? new Date() : null,
    actor: page.actor,
  }]));
  const createdDirectories: string[] = [];
  const createdPages: string[] = [];
  const updatedPages: string[] = [];
  const value = {
    directories: {
      async getByPath(path: string) {
        return directoryPaths.has(path) ? { id: path || "root" } : null;
      },
      async create(input: { path: string }) {
        directoryPaths.add(input.path);
        createdDirectories.push(input.path);
        return input;
      },
    },
    pages: {
      async getByPath(path: string) {
        return pages.get(path) ?? null;
      },
      async create(input: { path: string }) {
        createdPages.push(input.path);
        return input;
      },
      async update(_id: string, input: { path: string }) {
        updatedPages.push(input.path);
        return input;
      },
      async version(id: string) {
        const page = [...pages.values()].find((candidate) => candidate.id === id);
        return page ? { actor_subject: page.actor } : null;
      },
    },
  } as unknown as TemplateRepositories;
  return { value, createdDirectories, createdPages, updatedPages };
}

describe("knowledge templates", () => {
  test("discovers the plain AGENTS.md tree without mutating during a plan", async () => {
    const state = repositories();
    const result = await reconcileKnowledgeTemplate(state.value, "default", false);

    expect(result.actions.filter(({ action }) => action === "create-directory").map(({ path }) => path)).toEqual([
      "about",
      "automations",
      "companies",
      "events",
      "meetings",
      "people",
      "skills",
      "about/diary",
      "about/tasks",
    ]);
    expect(result.actions.filter(({ action }) => action === "create-guide")).toHaveLength(10);
    expect(state.createdDirectories).toEqual([]);
    expect(state.createdPages).toEqual([]);
  });

  test("updates bootstrap-owned guides while preserving locally edited guides", async () => {
    const state = repositories({
      directories: ["", "about", "about/diary", "about/tasks", "automations", "companies", "events", "meetings", "people", "skills"],
      pages: {
        agents: { body: "Legacy root.\n", actor: "context-use-bootstrap" },
        "people/agents": { body: "Owner rules.\n", actor: "owner-user-id" },
      },
    });
    const result = await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(state.updatedPages).toEqual(["agents"]);
    expect(state.createdPages).toHaveLength(8);
    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "people/agents",
      detail: "Preserve locally modified guide",
    });
    expect(formatTemplateResult(result)).toContain("Applied 9 changes; 1 conflict.");
  });

  test("adopts an identical local guide so future template changes can update it", async () => {
    const root = await Bun.file(new URL("../templates/default/AGENTS.md", import.meta.url)).text();
    const state = repositories({
      pages: { agents: { body: root.trimEnd() + "\n", actor: "owner-user-id" } },
    });
    const result = await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(result.actions).toContainEqual({
      action: "adopt-guide",
      path: "agents",
      detail: "Adopt matching local guide",
    });
    expect(state.updatedPages).toContain("agents");
  });

  test("reports page collisions without removing or overwriting existing knowledge", async () => {
    const state = repositories({
      pages: { about: { body: "Existing page.\n", actor: "owner-user-id" } },
    });
    const result = await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "about",
      detail: "Directory path is occupied by a page",
    });
    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "about/diary",
      detail: "Parent template directory is unavailable",
    });
    expect(state.createdDirectories).not.toContain("about");
    expect(state.createdPages).not.toContain("about/agents");
  });

  test("contains the reviewed status and privacy corrections", async () => {
    const root = await Bun.file(new URL("../templates/default/AGENTS.md", import.meta.url)).text();
    const diary = await Bun.file(new URL("../templates/default/about/diary/AGENTS.md", import.meta.url)).text();
    const meetings = await Bun.file(new URL("../templates/default/meetings/AGENTS.md", import.meta.url)).text();

    expect(root).toContain("only place that says where ongoing work currently stands");
    expect(root).toContain("deliberately public-safe entity page");
    expect(diary).toContain("Current state remains in the diary");
    expect(meetings).toContain("## Commitments made");
    expect(meetings).not.toContain("## Follow-ups");
  });
});
