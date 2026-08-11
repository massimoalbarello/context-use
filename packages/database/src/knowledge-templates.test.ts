import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TemplateRepositories } from "./knowledge-templates.ts";
import { formatTemplateResult, reconcileKnowledgeTemplate } from "./knowledge-templates.ts";

const DEFAULT_DIRECTORY_PRESENTATIONS = JSON.parse(
  await Bun.file(new URL("../templates/default/directories.json", import.meta.url)).text(),
) as Record<string, { title: string; summary: string }>;

const DEFAULT_DIRECTORY_PATHS = [
  "",
  "about",
  "automations",
  "companies",
  "events",
  "library",
  "meetings",
  "objects",
  "people",
  "places",
  "skills",
  "threads",
  "topics",
  "about/diary",
  "about/projects",
  "about/tasks",
  "automations/activity-distiller",
  "automations/diary-composer",
  "automations/guideline-consistency-review",
];

function repositories(options: {
  directories?: string[];
  directoryTitles?: Record<string, string>;
  directorySummaries?: Record<string, string>;
  pages?: Record<string, {
    body: string;
    actor: string;
    archived?: boolean;
    published?: boolean;
    title?: string;
    summary?: string;
  }>;
} = {}) {
  const directoryRecords = new Map((options.directories ?? [""]).map((path, index) => {
    const presentation = DEFAULT_DIRECTORY_PRESENTATIONS[path];
    return [path, {
      id: `directory-${index}`,
      current_path: path,
      version_number: 1,
      title: options.directoryTitles?.[path]
        ?? presentation?.title
        ?? (path ? path.split("/").at(-1)! : "Knowledge"),
      summary: options.directorySummaries?.[path]
        ?? presentation?.summary
        ?? "Existing directory summary.",
    }];
  }));
  const pages = new Map(Object.entries(options.pages ?? {}).map(([path, page], index) => [path, {
    id: `page-${index}`,
    current_path: path,
    version_number: 1,
    title: page.title ?? (path === "agents" || path.endsWith("/agents") ? "AGENTS.md" : path.split("/").at(-1)!),
    summary: page.summary ?? (path === "agents"
      ? "The global instructions for maintaining this knowledge base."
      : path.endsWith("/agents")
        ? `Instructions for maintaining knowledge in ${path.replace(/\/agents$/, "")}/.`
        : `Existing summary for ${path}.`),
    body_markdown: page.body,
    archived_at: page.archived ? new Date() : null,
    published_version_id: page.published ? `published-${index}` : null,
    actor: page.actor,
  }]));
  const createdDirectories: string[] = [];
  const createdDirectoryInputs: Array<{ path: string; title: string; summary: string }> = [];
  const updatedDirectories: string[] = [];
  const updatedDirectoryInputs: Array<{ title: string; summary: string; expected_version_number: number }> = [];
  const createdPages: string[] = [];
  const createdPageInputs: Array<{ path: string; title: string; summary: string; body_markdown: string }> = [];
  const updatedPages: string[] = [];
  const updatedPageInputs: Array<{ path: string; title: string; summary: string; body_markdown: string }> = [];
  const archivedPages: string[] = [];
  const value = {
    directories: {
      async getByPath(path: string) {
        return directoryRecords.get(path) ?? null;
      },
      async create(input: { path: string; title: string; summary: string }) {
        createdDirectories.push(input.path);
        createdDirectoryInputs.push(input);
        directoryRecords.set(input.path, {
          id: `directory-created-${createdDirectories.length}`,
          current_path: input.path,
          version_number: 1,
          ...input,
        });
        return input;
      },
      async update(id: string, input: { title: string; summary: string; expected_version_number: number }) {
        const record = [...directoryRecords.values()].find((candidate) => candidate.id === id)!;
        updatedDirectories.push(record.current_path);
        updatedDirectoryInputs.push(input);
        Object.assign(record, input, { version_number: record.version_number + 1 });
        return record;
      },
    },
    pages: {
      async getByPath(path: string) {
        return pages.get(path) ?? null;
      },
      async create(input: { path: string; title: string; summary: string; body_markdown: string }, actor: { subject: string }) {
        createdPages.push(input.path);
        createdPageInputs.push(input);
        pages.set(input.path, {
          id: `page-created-${createdPages.length}`,
          current_path: input.path,
          version_number: 1,
          title: input.title,
          summary: input.summary,
          body_markdown: input.body_markdown,
          archived_at: null,
          published_version_id: null,
          actor: actor.subject,
        });
        return input;
      },
      async update(id: string, input: { path: string; title: string; summary: string; body_markdown: string }, actor: { subject: string }) {
        const page = [...pages.values()].find((candidate) => candidate.id === id)!;
        updatedPages.push(input.path);
        updatedPageInputs.push(input);
        Object.assign(page, input, { version_number: page.version_number + 1, actor: actor.subject });
        return input;
      },
      async archive(id: string, _input: unknown, actor: { subject: string }) {
        const page = [...pages.values()].find((candidate) => candidate.id === id)!;
        archivedPages.push(page.current_path);
        Object.assign(page, {
          archived_at: new Date(),
          version_number: page.version_number + 1,
          actor: actor.subject,
        });
        return page;
      },
      async version(id: string) {
        const page = [...pages.values()].find((candidate) => candidate.id === id);
        return page ? { actor_subject: page.actor } : null;
      },
    },
  } as unknown as TemplateRepositories;
  return {
    value,
    createdDirectories,
    createdDirectoryInputs,
    updatedDirectories,
    updatedDirectoryInputs,
    createdPages,
    createdPageInputs,
    updatedPages,
    updatedPageInputs,
    archivedPages,
  };
}

async function withTemplateFixture<T>(
  files: Record<string, string>,
  run: (templateName: string) => Promise<T>,
): Promise<T> {
  const templateName = `test-${randomUUID()}`;
  const rootPath = fileURLToPath(new URL(`../templates/${templateName}/`, import.meta.url));
  await mkdir(rootPath);
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const path = `${rootPath}/${relativePath}`;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, "utf8");
    }
    return await run(templateName);
  } finally {
    await rm(rootPath, { recursive: true });
  }
}

const MINIMAL_TEMPLATE_FILES = {
  "AGENTS.md": "# Fixture guide\n",
  "directories.json": JSON.stringify({
    "": { title: "Knowledge", summary: "Fixture root." },
  }),
  "pages.json": "{}",
} as const;

describe("knowledge templates", () => {
  test("discovers the guide tree and its directory presentation without mutating during a plan", async () => {
    const state = repositories();
    const result = await reconcileKnowledgeTemplate(state.value, "default", false);

    expect(result.actions.filter(({ action }) => action === "create-directory").map(({ path }) => path)).toEqual([
      "about",
      "automations",
      "companies",
      "events",
      "library",
      "meetings",
      "objects",
      "people",
      "places",
      "skills",
      "threads",
      "topics",
      "about/diary",
      "about/projects",
      "about/tasks",
      "automations/activity-distiller",
      "automations/diary-composer",
      "automations/guideline-consistency-review",
    ]);
    expect(result.actions.filter(({ action }) => action === "create-guide")).toHaveLength(16);
    expect(result.actions.filter(({ action }) => action === "create-page").map(({ path }) => path)).toEqual([
      "automations/activity-distiller/instructions",
      "automations/activity-distiller/state",
      "automations/diary-composer/instructions",
      "automations/diary-composer/state",
      "automations/guideline-consistency-review/instructions",
    ]);
    expect(state.createdDirectories).toEqual([]);
    expect(state.createdPages).toEqual([]);
    expect(formatTemplateResult(result)).toContain("+ create-directory library");
    expect(formatTemplateResult(result)).toContain("✓ Planned 39 changes; 0 conflicts.");
    expect(formatTemplateResult(result, true)).toContain("\u001B[32m+\u001B[0m create-directory");
  });

  test("reports a missing knowledge root and blocks all template writes", async () => {
    const state = repositories({ directories: [] });

    const result = await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "",
      detail: "Root knowledge directory is missing",
    });
    expect(state.createdDirectories).toEqual([]);
    expect(state.createdPages).toEqual([]);
    expect(state.updatedDirectories).toEqual([]);
    expect(state.updatedPages).toEqual([]);
    expect(formatTemplateResult(result)).toContain("Applied 0 changes;");
  });

  test("creates directory summaries and fills only summaries that are still blank", async () => {
    const state = repositories({
      directories: DEFAULT_DIRECTORY_PATHS,
      directorySummaries: {
        library: "",
        objects: "  ",
        places: "Owner-authored place summary.",
      },
    });

    const result = await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(state.updatedDirectories).toEqual(["library", "objects"]);
    expect(state.updatedDirectoryInputs.map(({ summary }) => summary)).toEqual([
      "External works saved for recall, with their useful ideas, the owner's reaction, and connections to existing knowledge.",
      "Individually meaningful physical things whose identity or history matters over time.",
    ]);
    expect(result.actions).toContainEqual({
      action: "update-directory",
      path: "library",
      detail: "Add template summary for Library",
    });
    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "places",
      detail: "Directory metadata differs from the template; preserve local metadata",
    });
    expect(formatTemplateResult(result)).toContain("Applied 23 changes; 1 conflict.");
  });

  test("surfaces directory metadata drift without overwriting local presentation", async () => {
    const state = repositories({
      directories: DEFAULT_DIRECTORY_PATHS,
      directoryTitles: { people: "Contacts" },
      directorySummaries: { people: "The owner's intentionally customized contacts directory." },
    });

    const result = await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "people",
      detail: "Directory metadata differs from the template; preserve local metadata",
    });
    expect(state.updatedDirectories).not.toContain("people");
  });

  test("force template overwrites all eligible local template customizations", async () => {
    const state = repositories({
      directories: DEFAULT_DIRECTORY_PATHS,
      directoryTitles: { people: "Contacts" },
      directorySummaries: { people: "The owner's intentionally customized contacts directory." },
      pages: {
        agents: {
          body: "Owner root rules.\n",
          actor: "owner-user-id",
        },
        "automations/activity-distiller/instructions": {
          title: "Local activity distiller",
          summary: "Local activity distiller instructions.",
          body: "Owner-specific maintenance policy.\n",
          actor: "owner-user-id",
        },
        "automations/activity-distiller/state": {
          title: "Owner's activity checkpoint",
          summary: "Owner checkpoint.",
          body: "# Activity distiller state\n\n**Checkpoint:** `cu-nango-v1.live`\n",
          actor: "owner-user-id",
        },
      },
    });

    const result = await reconcileKnowledgeTemplate(state.value, "default", true, true);

    expect(result.actions).toContainEqual({
      action: "update-directory",
      path: "people",
      detail: "Overwrite local directory metadata with the template",
    });
    expect(state.updatedDirectoryInputs).toContainEqual({
      title: DEFAULT_DIRECTORY_PRESENTATIONS.people!.title,
      summary: DEFAULT_DIRECTORY_PRESENTATIONS.people!.summary,
      expected_version_number: 1,
    });
    expect(result.actions).toContainEqual({
      action: "replace-guide",
      path: "agents",
      detail: "Overwrite locally modified guide",
    });
    expect(result.actions).toContainEqual({
      action: "update-page",
      path: "automations/activity-distiller/instructions",
      detail: "Overwrite locally modified template page",
    });
    expect(result.actions).toContainEqual({
      action: "unchanged",
      path: "automations/activity-distiller/state",
      detail: "Preserve create-only template page",
    });
    expect(state.updatedPages).toContain("agents");
    expect(state.updatedPages).toContain("automations/activity-distiller/instructions");
    expect(state.updatedPages).not.toContain("automations/activity-distiller/state");
  });

  test("uses authored presentation when creating template directories", async () => {
    const state = repositories();

    await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(state.createdDirectoryInputs).toContainEqual({
      path: "places",
      title: "Places",
      summary: "Locations that matter because the owner returns to them, makes decisions about them, or connects them to several parts of the knowledge base.",
    });
    expect(state.createdDirectoryInputs.every(({ summary }) => summary.length > 0)).toBe(true);
    expect(state.createdPageInputs.find(({ path }) => path === "automations/activity-distiller/instructions"))
      .toMatchObject({
        title: "Activity distiller",
        summary: "Instructions for distilling connected activity one record at a time into dense, linked canonical knowledge.",
        body_markdown: expect.stringContaining("## One run, one record at a time"),
      });
    expect(state.createdPageInputs.find(({ path }) => path === "automations/activity-distiller/state"))
      .toMatchObject({
        title: "Activity distiller state",
        summary: "The current opaque source checkpoint for the activity distiller.",
        body_markdown: "# Activity distiller state\n\n**Checkpoint:** _none_\n",
      });
    expect(state.createdPageInputs.find(({ path }) => path === "automations/guideline-consistency-review/instructions"))
      .toMatchObject({
        title: "Guideline consistency review",
        body_markdown: expect.stringContaining("## Select the fixed change window"),
      });
  });

  test("updates untouched instructions but never overwrites live checkpoint state", async () => {
    const state = repositories({
      directories: DEFAULT_DIRECTORY_PATHS,
      pages: {
        "automations/activity-distiller/instructions": {
          title: "Activity distiller",
          summary: "Instructions for distilling connected activity one record at a time into dense, linked canonical knowledge.",
          body: "Old template instructions.\n",
          actor: "context-use-template/default",
        },
        "automations/activity-distiller/state": {
          title: "Owner's activity checkpoint",
          summary: "The owner's customized description of this live checkpoint.",
          body: "# Activity distiller state\n\n**Checkpoint:** `cu-nango-v1.live`\n",
          actor: "context-use-template/default",
        },
      },
    });

    const result = await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(result.actions).toContainEqual({
      action: "update-page",
      path: "automations/activity-distiller/instructions",
      detail: "Update untouched template page",
    });
    expect(result.actions).toContainEqual({
      action: "unchanged",
      path: "automations/activity-distiller/state",
      detail: "Preserve create-only template page",
    });
    expect(state.updatedPages).toContain("automations/activity-distiller/instructions");
    expect(state.updatedPages).not.toContain("automations/activity-distiller/state");
  });

  test("reports corrupt create-only page structure without overwriting live state", async () => {
    const state = repositories({
      directories: DEFAULT_DIRECTORY_PATHS,
      pages: {
        "automations/activity-distiller/state": {
          title: "Owner's activity checkpoint",
          summary: "Owner checkpoint.",
          body: "# Activity distiller state\n\nThe checkpoint field was removed.\n",
          actor: "owner-user-id",
        },
      },
    });

    const result = await reconcileKnowledgeTemplate(state.value, "default", true, true);

    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "automations/activity-distiller/state",
      detail: "Create-only template page is missing required structure: **Checkpoint:**",
    });
    expect(state.updatedPages).not.toContain("automations/activity-distiller/state");
  });

  test("preserves locally customized activity-distiller instructions", async () => {
    const state = repositories({
      directories: DEFAULT_DIRECTORY_PATHS,
      pages: {
        "automations/activity-distiller/instructions": {
          title: "Activity distiller",
          summary: "Local activity distiller instructions.",
          body: "Owner-specific maintenance policy.\n",
          actor: "owner-user-id",
        },
      },
    });

    const result = await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "automations/activity-distiller/instructions",
      detail: "Preserve locally modified template page",
    });
    expect(state.updatedPages).not.toContain("automations/activity-distiller/instructions");
  });

  test("overwrites locally customized managed pages only when explicitly requested", async () => {
    const state = repositories({
      directories: DEFAULT_DIRECTORY_PATHS,
      pages: {
        "automations/activity-distiller/instructions": {
          title: "Activity distiller",
          summary: "Local activity distiller instructions.",
          body: "Owner-specific maintenance policy.\n",
          actor: "owner-user-id",
        },
        "automations/activity-distiller/state": {
          title: "Activity distiller state",
          summary: "The current opaque source checkpoint for the activity distiller.",
          body: "# Activity distiller state\n\n**Checkpoint:** `cu-nango-v1.live`\n",
          actor: "owner-user-id",
        },
      },
    });

    const overwritePlan = await reconcileKnowledgeTemplate(state.value, "default", false, true);
    expect(overwritePlan.actions).toContainEqual({
      action: "update-page",
      path: "automations/activity-distiller/instructions",
      detail: "Overwrite locally modified template page",
    });
    expect(overwritePlan.actions).toContainEqual({
      action: "unchanged",
      path: "automations/activity-distiller/state",
      detail: "Preserve create-only template page",
    });
    expect(state.updatedPages).toEqual([]);

    const applied = await reconcileKnowledgeTemplate(state.value, "default", true, true);
    expect(state.updatedPages).toEqual(["automations/activity-distiller/instructions"]);
    expect(state.updatedPageInputs).toContainEqual(expect.objectContaining({
      path: "automations/activity-distiller/instructions",
      body_markdown: expect.stringContaining("## One run, one record at a time"),
    }));
    expect(formatTemplateResult(applied)).toContain("~ update-page      automations/activity-distiller/instructions");
  });

  test("updates bootstrap-owned guides while preserving locally edited guides", async () => {
    const state = repositories({
      directories: DEFAULT_DIRECTORY_PATHS,
      pages: {
        agents: { body: "Legacy root.\n", actor: "context-use-bootstrap" },
        "people/agents": { body: "Owner rules.\n", actor: "owner-user-id" },
      },
    });
    const result = await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(state.updatedPages).toEqual(["agents"]);
    expect(state.createdPages).toHaveLength(19);
    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "people/agents",
      detail: "Preserve locally modified guide",
    });
    expect(formatTemplateResult(result)).toContain("Applied 20 changes; 1 conflict.");
    expect(formatTemplateResult(result)).toContain("~ update-guide     agents");
    expect(formatTemplateResult(result)).toContain("! conflict         people/agents");
    expect(formatTemplateResult(result, true)).toContain("\u001B[31m!\u001B[0m conflict");
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

  test("overwrites active local guides only when explicitly requested", async () => {
    const state = repositories({
      directories: DEFAULT_DIRECTORY_PATHS,
      pages: {
        agents: { body: "Owner root rules.\n", actor: "owner-user-id" },
        "people/agents": { body: "Archived owner rules.\n", actor: "owner-user-id", archived: true },
      },
    });

    const ordinaryPlan = await reconcileKnowledgeTemplate(state.value, "default", false);
    expect(ordinaryPlan.actions).toContainEqual({
      action: "conflict",
      path: "agents",
      detail: "Preserve locally modified guide",
    });

    const overwritePlan = await reconcileKnowledgeTemplate(state.value, "default", false, true);
    expect(overwritePlan.actions).toContainEqual({
      action: "replace-guide",
      path: "agents",
      detail: "Overwrite locally modified guide",
    });
    expect(overwritePlan.actions).toContainEqual({
      action: "conflict",
      path: "people/agents",
      detail: "Guide was archived locally",
    });
    expect(state.updatedPages).toEqual([]);

    const applied = await reconcileKnowledgeTemplate(state.value, "default", true, true);
    expect(state.updatedPages).toEqual(["agents"]);
    expect(formatTemplateResult(applied)).toContain("Applied 20 changes; 1 conflict.");
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

  test("reports template page paths occupied by existing directories", async () => {
    const state = repositories({
      directories: [
        ...DEFAULT_DIRECTORY_PATHS,
        "automations/activity-distiller/instructions",
        "automations/activity-distiller/state",
      ],
    });
    const result = await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "automations/activity-distiller/instructions",
      detail: "Page path is occupied by a directory",
    });
    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "automations/activity-distiller/state",
      detail: "Page path is occupied by a directory",
    });
    expect(state.createdPages).not.toContain("automations/activity-distiller/instructions");
    expect(state.createdPages).not.toContain("automations/activity-distiller/state");
  });

  test("archives only explicitly retired, unpublished, template-owned pages", async () => {
    await withTemplateFixture({
      ...MINIMAL_TEMPLATE_FILES,
      "pages.json": "{}",
      "retired.json": JSON.stringify({
        directories: ["retired"],
        pages: [
          "retired/already-archived",
          "retired/local",
          "retired/owned",
          "retired/published",
        ],
      }),
    }, async (templateName) => {
      const templateActor = `context-use-template/${templateName}`;
      const state = repositories({
        directories: ["", "retired"],
        directorySummaries: { "": "Fixture root." },
        pages: {
          "retired/already-archived": {
            body: "Old template page.\n",
            actor: templateActor,
            archived: true,
          },
          "retired/local": {
            body: "Owner changed this page.\n",
            actor: "owner-user-id",
          },
          "retired/owned": {
            body: "Untouched old template page.\n",
            actor: templateActor,
          },
          "retired/published": {
            body: "Published old template page.\n",
            actor: templateActor,
            published: true,
          },
        },
      });

      const result = await reconcileKnowledgeTemplate(state.value, templateName, true);

      expect(state.archivedPages).toEqual(["retired/owned"]);
      expect(result.actions).toContainEqual({
        action: "retire-page",
        path: "retired/owned",
        detail: "Archive retired template page",
      });
      expect(result.actions).toContainEqual({
        action: "conflict",
        path: "retired/local",
        detail: "Retired template page has local changes; preserve it",
      });
      expect(result.actions).toContainEqual({
        action: "conflict",
        path: "retired/published",
        detail: "Retired template page is published; preserve it",
      });
      expect(result.actions).toContainEqual({
        action: "conflict",
        path: "retired",
        detail: "Retired template directory remains; preserve it for manual review",
      });
    });
  });

  test("rejects orphaned and multiply referenced managed page bodies", async () => {
    const page = (bodyFile: string) => ({
      title: "Fixture page",
      summary: "A fixture page used to validate template body ownership.",
      body_file: bodyFile,
      management: "managed",
    });

    await withTemplateFixture({
      ...MINIMAL_TEMPLATE_FILES,
      "pages.json": JSON.stringify({ fixture: page("_pages/used.md") }),
      "_pages/used.md": "# Used\n",
      "_pages/orphan.md": "# Orphan\n",
    }, async (templateName) => {
      const state = repositories({ directorySummaries: { "": "Fixture root." } });
      await expect(reconcileKnowledgeTemplate(state.value, templateName)).rejects.toThrow(
        "Template page body file is orphaned: _pages/orphan.md",
      );
    });

    await withTemplateFixture({
      ...MINIMAL_TEMPLATE_FILES,
      "pages.json": JSON.stringify({
        first: page("_pages/shared.md"),
        second: { ...page("_pages/shared.md"), title: "Second fixture page" },
      }),
      "_pages/shared.md": "# Shared\n",
    }, async (templateName) => {
      const state = repositories({ directorySummaries: { "": "Fixture root." } });
      await expect(reconcileKnowledgeTemplate(state.value, templateName)).rejects.toThrow(
        "Template page body file is referenced more than once: _pages/shared.md",
      );
    });
  });

  test("keeps shared contracts in parent guides and local shape in child guides", async () => {
    const guides = {
      root: await Bun.file(new URL("../templates/default/AGENTS.md", import.meta.url)).text(),
      about: await Bun.file(new URL("../templates/default/about/AGENTS.md", import.meta.url)).text(),
      diary: await Bun.file(new URL("../templates/default/about/diary/AGENTS.md", import.meta.url)).text(),
      projects: await Bun.file(new URL("../templates/default/about/projects/AGENTS.md", import.meta.url)).text(),
      tasks: await Bun.file(new URL("../templates/default/about/tasks/AGENTS.md", import.meta.url)).text(),
      automations: await Bun.file(new URL("../templates/default/automations/AGENTS.md", import.meta.url)).text(),
      companies: await Bun.file(new URL("../templates/default/companies/AGENTS.md", import.meta.url)).text(),
      events: await Bun.file(new URL("../templates/default/events/AGENTS.md", import.meta.url)).text(),
      library: await Bun.file(new URL("../templates/default/library/AGENTS.md", import.meta.url)).text(),
      meetings: await Bun.file(new URL("../templates/default/meetings/AGENTS.md", import.meta.url)).text(),
      objects: await Bun.file(new URL("../templates/default/objects/AGENTS.md", import.meta.url)).text(),
      people: await Bun.file(new URL("../templates/default/people/AGENTS.md", import.meta.url)).text(),
      places: await Bun.file(new URL("../templates/default/places/AGENTS.md", import.meta.url)).text(),
      skills: await Bun.file(new URL("../templates/default/skills/AGENTS.md", import.meta.url)).text(),
      threads: await Bun.file(new URL("../templates/default/threads/AGENTS.md", import.meta.url)).text(),
      topics: await Bun.file(new URL("../templates/default/topics/AGENTS.md", import.meta.url)).text(),
    };
    const activityDistiller = await Bun.file(
      new URL("../templates/default/_pages/activity-distiller/instructions.md", import.meta.url),
    ).text();
    const diaryComposer = await Bun.file(
      new URL("../templates/default/_pages/diary-composer/instructions.md", import.meta.url),
    ).text();
    const normalize = (value: string) => value.replaceAll(/\s+/g, " ");
    const normalizedRoot = normalize(guides.root);
    const normalizedDistiller = normalize(activityDistiller);
    const normalizedComposer = normalize(diaryComposer);
    const normalizedComposerLower = normalizedComposer.toLowerCase();
    const rootIndex = guides.root.slice(
      guides.root.indexOf("## Guide and managed-page index"),
      guides.root.indexOf("## Curate, do not filter"),
    );

    const indexedPaths = [...rootIndex.matchAll(/\[\[([^|#\]]+)(?:#[^|\]]+)?\|/g)]
      .map((match) => match[1]);
    expect(indexedPaths).toEqual([
      "about/agents",
      "about/diary/agents",
      "about/projects/agents",
      "about/tasks/agents",
      "automations/agents",
      "companies/agents",
      "events/agents",
      "library/agents",
      "meetings/agents",
      "objects/agents",
      "people/agents",
      "places/agents",
      "skills/agents",
      "threads/agents",
      "topics/agents",
      "automations/activity-distiller/instructions",
      "automations/activity-distiller/state",
      "automations/diary-composer/instructions",
      "automations/diary-composer/state",
    ]);

    for (const guide of [
      guides.about,
      guides.automations,
      guides.companies,
      guides.events,
      guides.library,
      guides.meetings,
      guides.objects,
      guides.people,
      guides.places,
      guides.skills,
      guides.threads,
      guides.topics,
    ]) {
      expect(guide).toContain("[[agents|root guide]]");
    }
    for (const guide of [guides.diary, guides.projects, guides.tasks]) {
      expect(guide).toContain("[[about/agents|About conventions]]");
    }

    expect(guides.root).toContain("## Curate, do not filter");
    expect(normalizedRoot).toContain("A detail is never dropped for being small");
    expect(normalizedRoot).toContain("a page stays readable through **placement, not omission**");
    expect(normalizedRoot).toContain("None of this licenses copying the source in");
    expect(normalizedRoot).toContain("When a page speaks as the owner, use first person");
    expect(normalizedRoot).toContain("without asking for a preview or proposal");
    expect(normalizedRoot).toContain("Every entity is a folder, entered through `intro`");
    expect(guides.root).toContain("### Identifiability is the threshold");
    expect(guides.root).toContain("### A subject arrives one of two ways");
    expect(normalizedRoot).toContain("A subject earns its page as soon as the evidence resolves which subject it is");
    expect(normalizedRoot).toContain("What holds a subject back is doubt about *which* subject it is");
    expect(normalizedRoot).toContain("This threshold runs **after** the noise filter above");
    expect(normalizedRoot).toContain("Attention is not interaction and is not agreement");
    expect(guides.root).toContain("## The timeline");
    expect(normalizedRoot).toContain("Descending year headings, descending month headings");
    expect(normalizedRoot).toContain("Never link the diary from a timeline event");
    expect(normalizedRoot).toContain("No activity writer also writes the diary");
    expect(normalizedRoot).toContain("an automation maintaining knowledge is not diary activity");
    expect(normalizedRoot).toContain("however far in the past that day is");
    expect(guides.root).toContain("## Three homes");
    expect(guides.root).toContain("## Which entity does it belong to");
    expect(normalizedRoot).toContain("climb until you reach one it does");
    expect(normalizedRoot).toContain("Rewrite or remove claims that later evidence shows to be wrong or misleading");
    expect(guides.root).toContain("## Write, then report");
    expect(normalizedRoot).toContain("Highlight newly created entities");
    expect(normalizedRoot).toContain("Every child guide links its direct parent guide");
    expect(normalizedRoot).toContain("Never store credentials, access tokens, access codes or recovery secrets");
    expect(guides.root).toContain("## Referencing uploaded assets");
    expect(guides.root).toContain("![Cover letter](context-use://asset/<uuid>)");
    expect(guides.root).not.toContain("people/<person-slug>");
    expect(guides.root).not.toContain("meetings/<YYYY>");

    for (const child of Object.values(guides).filter((guide) => guide !== guides.root)) {
      expect(child).not.toContain("## Reconcile the canonical account");
      expect(child).not.toContain("## The timeline");
      expect(child).not.toContain("## Write, then report");
      expect(child).not.toContain("not a mandatory template");
      expect(child).not.toContain("required scaffolding");
    }

    expect(guides.about).toContain("about/intro");
    expect(normalize(guides.about)).toContain("not managed by the default template");
    expect(guides.about).not.toContain("## Owner voice");
    expect(guides.about).toContain("[[about/diary/agents|");
    expect(guides.about).toContain("[[about/projects/agents|");
    expect(guides.about).toContain("[[about/tasks/agents|");
    expect(normalize(guides.diary)).toContain("Repeated mention is not continuation");
    expect(normalize(guides.diary)).toContain("Correct what is wrong or misleading");
    expect(guides.diary).toContain("[[automations/diary-composer/instructions|diary composer]]");
    expect(normalize(guides.diary)).toContain("The diary is the route through the knowledge, not a second copy of it");
    expect(normalize(guides.diary)).toContain("Most days need only `intro`");
    expect(normalize(guides.diary)).toContain("one page or become several connected views");
    expect(normalize(guides.diary)).toContain("There are no required sections");
    expect(normalize(guides.diary)).toContain("Never invent cause, mood or a unifying theme");
    expect(guides.diary).not.toContain("## On my mind");
    expect(guides.diary).not.toContain("## Threads");
    expect(guides.projects).toContain("about/projects/<slug>/");
    expect(guides.tasks).toContain("about/tasks/<slug>/");
    expect(normalize(guides.tasks)).toContain("Resolution always earns a dated timeline event");

    expect(normalizedRoot).toContain("A common template is a vocabulary, not a quota");
    expect(guides.root).toContain("## Shape follows the content");
    expect(normalizedRoot).toContain(
      "A guide says what a page has to establish, never what it has to look like",
    );
    expect(normalizedRoot).toContain("it is one way a page has met its obligation and not the way");
    expect(normalizedRoot).toContain("What binds is the obligations");
    expect(normalizedRoot).toContain(
      "An entity that has accumulated views is a small hypermedia of its own",
    );
    expect(normalizedRoot).toContain("Outward links are the other half of the same fabric");
    expect(normalizedRoot).toContain("This holds inside an entity folder as much as across the base");

    // Content guides state what a page must establish; none hands over a skeleton to copy.
    // A diary day may have different views, but its prose and headings follow the material too.
    const contentGuides = [
      guides.diary,
      guides.companies,
      guides.events,
      guides.library,
      guides.meetings,
      guides.objects,
      guides.people,
      guides.places,
      guides.projects,
      guides.tasks,
      guides.threads,
      guides.topics,
    ].join("\n");
    for (const skeleton of [
      "Suggested shape",
      "Example intro",
      "Example pages",
      "**How the owner knows them:**",
      "**What they do:**",
      "**Kind:**",
      "**Associated with:**",
      "**With:**",
      "## What was said",
      "## What I took away",
      "## Commitments made",
      "## What happened",
      "## Why it matters to me",
      "## Where it stands",
      "## Owner's note",
      "## Summary",
      "├──",
    ]) {
      expect(contentGuides).not.toContain(skeleton);
    }

    expect(normalize(guides.companies)).toContain("Most folders remain a single `intro`");
    expect(guides.companies).not.toContain("as soon as `intro` starts having sections");
    expect(normalize(guides.meetings)).toContain("A confirmed future meeting may begin with `prep` alone");
    expect(normalize(guides.meetings)).toContain("a lifecycle exception to the root `intro` entry-point convention");
    expect(normalize(guides.meetings)).toContain("Every resolvable attendee gets their page on the");
    expect(normalize(guides.people)).toContain("Most people need only `intro`");
    expect(guides.people).not.toContain("`interests`");
    expect(normalize(guides.people)).toContain("meaningful change in what the person is doing");
    expect(normalize(guides.people)).toContain("nothing filled in to make the set look complete");
    expect(normalize(guides.meetings)).toContain("Let the page take the shape the conversation had");
    for (const guide of [guides.companies, guides.library, guides.objects, guides.people, guides.places, guides.topics]) {
      expect(guide).toMatch(/## What an? [a-z ]+ establishes/);
    }
    expect(DEFAULT_DIRECTORY_PRESENTATIONS.about!.summary).not.toContain("themes, practices, and interests");
    expect(DEFAULT_DIRECTORY_PRESENTATIONS.meetings!.summary).not.toContain("recording who was there");
    expect(guides.skills).toContain("page metadata title is exactly `SKILL.md`");
    expect(guides.skills).toContain("page path leaf and YAML frontmatter `name` are exactly equal");
    expect(normalize(guides.skills)).toContain("page metadata summary is the discovery mechanism");
    expect(normalize(guides.skills)).toContain("a local exception to the root entity-folder default");
    // The multi-writer rule governs every writer, not only automations, so it lives in the
    // root guide; this one keeps only the layout of its own directory.
    expect(normalizedRoot).toContain("preserve every other byte as found");
    expect(normalize(guides.automations)).not.toContain("preserve every other byte as found");
    expect(normalize(guides.automations)).toContain("a local exception to the root `intro` entry-point convention");
    expect(normalize(guides.automations)).toContain("Run logs, retry histories, source records");
    expect(normalize(guides.automations)).not.toContain("about/diary/");
    expect(normalize(guides.diary)).toContain("Its `intro` is the entry point");

    expect(diaryComposer).toContain("[[agents|root guide]]");
    expect(diaryComposer).toContain("[[automations/agents|automation guide]]");
    expect(diaryComposer).toContain("[[about/diary/agents|diary guide]]");
    expect(diaryComposer).toContain("`cached_guidance_receipt`");
    expect(normalizedComposerLower).toContain("run on its own schedule");
    expect(normalizedComposerLower).toContain("never read, wait on or mutate another automation's instructions or state");
    expect(normalizedComposerLower).toContain("never use another automation's checkpoint or report as a precondition");
    expect(normalizedComposerLower).not.toContain("activity distiller has completed");
    expect(normalizedComposerLower).toContain("call `get_knowledge_changes` with that cursor and no `limit`");
    expect(normalizedComposerLower).toContain("only the semantic difference between the versions is evidence newly reaching this run");
    expect(normalizedComposerLower).toContain("a one-word correction contributes only the corrected meaning");
    expect(normalizedComposerLower).toContain("there is no recency cutoff");
    expect(normalizedComposerLower).toContain("creates or reconciles its historical day");
    expect(normalizedComposerLower).toContain("its `changed_at`, creation time, commit time and the composer's run date never choose a diary day");
    expect(normalizedComposerLower).toContain("make `intro` the prose entry point");
    expect(normalizedComposerLower).toContain("the same meeting, exchange, decision or movement recorded from several entity sides is one activity");
    expect(normalizedComposerLower).toContain("do not mine those pages for facts to repeat in the diary");
    expect(normalizedComposerLower).toContain("use `get_page_history` as far as needed");
    expect(normalizedComposerLower).toContain("use `search_pages` with the canonical subject path to find the most recent diary page");
    expect(normalizedComposerLower).toContain("use separate paragraphs, descriptive headings or separate day views");
    expect(normalizedComposerLower).toContain("`created`, `updated` and `archived` lists");
    expect(diaryComposer).not.toContain("## On my mind");
    expect(diaryComposer).not.toContain("## Threads");
    expect(diaryComposer).not.toContain("Recorded nothing dated");

    expect(normalizedDistiller).toContain("Before the first mutation in a guidance scope");
    expect(activityDistiller).toContain("[[agents|root guide]]");
    expect(activityDistiller).toContain("[[automations/agents|automation guide]]");
    expect(activityDistiller).toContain("`cached_guidance_receipt`");
    expect(normalizedDistiller).toContain("Carry out the mutations those guides support without a preview");
    expect(normalizedDistiller).toContain("let its guide chain decide the useful pages");
    expect(normalizedDistiller).toContain("Apply the meeting guide's participant rule");
    expect(normalizedDistiller).toContain("Apply the root timeline contract in the same coherent write");
    expect(normalizedDistiller).toContain("`Created`, `Updated` and `Archived` lists");
    for (const detail of [
      "read_source_records",
      "record_ref",
      "next_checkpoint",
      "has_more",
      "more than 30 days",
      "pruned deletion",
      "one run, one record at a time",
    ]) {
      expect(normalizedDistiller.toLowerCase()).toContain(detail);
    }

    const guidesWithoutAutomation = [
      guides.about,
      guides.companies,
      guides.events,
      guides.library,
      guides.meetings,
      guides.objects,
      guides.people,
      guides.places,
      guides.projects,
      guides.tasks,
      guides.skills,
      guides.threads,
      guides.topics,
    ].join("\n").toLowerCase();
    for (const detail of ["read_source_records", "record_ref", "next_checkpoint", "has_more", "pruned deletion"]) {
      expect(guidesWithoutAutomation).not.toContain(detail);
    }
  });
});
