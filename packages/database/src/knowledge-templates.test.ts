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
      DEFAULT_DIRECTORY_PRESENTATIONS.library!.summary,
      DEFAULT_DIRECTORY_PRESENTATIONS.objects!.summary,
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
      title: DEFAULT_DIRECTORY_PRESENTATIONS.places!.title,
      summary: DEFAULT_DIRECTORY_PRESENTATIONS.places!.summary,
    });
    expect(state.createdDirectoryInputs.every(({ summary }) => summary.length > 0)).toBe(true);
    expect(state.createdPageInputs.find(({ path }) => path === "automations/activity-distiller/instructions"))
      .toMatchObject({
        title: "Activity distiller",
        summary: "Instructions for distilling connected activity one record at a time into dense, linked canonical knowledge.",
        body_markdown: expect.stringContaining("## State machine"),
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
        body_markdown: expect.stringContaining("### 1. Select the fixed change window"),
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
      body_markdown: expect.stringContaining("## State machine"),
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

  test("keeps global invariants in the root and local contracts in descendant guides", async () => {
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
    const normalize = (value: string) => value.replaceAll(/\s+/g, " ");
    const normalizedRoot = normalize(guides.root);

    expect(guides.root.split(/\s+/).length).toBeLessThan(2_500);
    expect(guides.root).not.toContain("## Guide and managed-page index");

    for (const heading of [
      "## Curate, do not filter",
      "### Identifiability is the threshold",
      "### A subject arrives one of two ways",
      "## Place and identify",
      "## Shape follows the content",
      "## Three homes",
      "## The timeline",
      "## Reconcile the canonical account",
      "## Sources and links",
      "## Referencing uploaded assets",
      "## Privacy",
      "## Write, then report",
      "## Directories and guide layering",
    ]) {
      expect(guides.root).toContain(heading);
    }

    for (const invariant of [
      "a detail is never dropped for being small",
      "placement, not omission",
      "owner engagement, repetition, prominence and predicted importance do not decide",
      "a record discarded as noise is discarded whole",
      "every identifiable subject in a retained record is written",
      "every entity is a folder entered through `intro`",
      "date activity to when it happened",
      "what the owner did, experienced or learned involving its entity",
      "never link the diary from a timeline event",
      "an automation maintaining knowledge is not activity in the owner's life",
      "later is not automatically correct",
      "preserve every other byte as found",
      "never link a page that does not exist",
      "never store credentials, access tokens, access codes or recovery secrets",
    ]) {
      expect(normalizedRoot.toLowerCase()).toContain(invariant);
    }

    expect(guides.root).toContain("![Cover letter](context-use://asset/<uuid>)");
    expect(guides.root).not.toContain("meetings/<YYYY>");
    expect(guides.root).not.toContain("about/projects/<slug>");

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

    const entityGuides = [
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
    ];
    for (const guide of entityGuides) {
      expect(guide).toContain("[[agents#identifiability-is-the-threshold|identifiability invariant]]");
    }

    const descendants = Object.values(guides).filter((guide) => guide !== guides.root);
    for (const guide of descendants) {
      expect(guide).not.toContain("## Reconcile the canonical account");
      expect(guide).not.toContain("## The timeline");
      expect(guide).not.toContain("A detail is never dropped for being small");
      expect(guide).not.toContain("A subject earns its canonical page");
    }

    expect(normalize(guides.about)).toContain("`about/` has no `timeline`");
    expect(normalize(guides.diary)).toContain("An entity or timeline change is a candidate, not a quota");
    expect(normalize(guides.diary)).toContain("Repeated mention is not continuation");
    expect(normalize(guides.diary)).toContain("Preserve every owner-written passage exactly");
    expect(guides.projects).toContain("about/projects/<slug>/");
    expect(guides.tasks).toContain("about/tasks/<slug>/");
    expect(normalize(guides.tasks)).toContain("Resolution always receives a dated timeline event");
    expect(normalize(guides.meetings)).toContain("A confirmed future meeting may begin with `prep` alone");
    expect(normalize(guides.skills)).toContain("local runtime exception to the root entity-folder default");
    expect(normalize(guides.threads)).toContain("Every thread begins with both `intro` and `timeline`");
    expect(normalize(guides.threads)).toContain("corrections to existing lines follow the root reconciliation rule");
    expect(guides.threads).not.toContain("only ever appended");
    expect(normalize(guides.library)).toContain("Every resolvable creator and publisher receives its own canonical entity");

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
      "**How the owner knows them:**",
      "## What was said",
      "## Commitments made",
      "## Where it stands",
      "## Owner's note",
      "## Summary",
      "├──",
    ]) {
      expect(contentGuides).not.toContain(skeleton);
    }
  });

  test("keeps automation instructions procedural and complete", async () => {
    const automationGuide = await Bun.file(
      new URL("../templates/default/automations/AGENTS.md", import.meta.url),
    ).text();
    const activityDistiller = await Bun.file(
      new URL("../templates/default/_pages/activity-distiller/instructions.md", import.meta.url),
    ).text();
    const diaryComposer = await Bun.file(
      new URL("../templates/default/_pages/diary-composer/instructions.md", import.meta.url),
    ).text();
    const guidelineReviewer = await Bun.file(
      new URL("../templates/default/_pages/guideline-consistency-review/instructions.md", import.meta.url),
    ).text();
    const normalize = (value: string) => value.replaceAll(/\s+/g, " ").toLowerCase();
    const normalizedAutomationGuide = normalize(automationGuide);
    const normalizedDistiller = normalize(activityDistiller);
    const normalizedComposer = normalize(diaryComposer);

    expect(normalizedAutomationGuide).toContain("instructions");
    expect(normalizedAutomationGuide).toContain("state");
    expect(normalizedAutomationGuide).toContain("each automation runs independently");
    expect(normalizedAutomationGuide).toContain("instead of copying their rules");
    expect(normalizedAutomationGuide).toContain("creating or changing an automation");
    expect(normalizedAutomationGuide).toContain("numbered headings for states");
    expect(normalizedAutomationGuide).toContain("lettered labels for ordered substeps");
    expect(normalizedAutomationGuide).toContain(
      "ordinary bullets for unordered criteria and invariants",
    );
    expect(normalizedAutomationGuide).toContain("objective failure conditions named by the workflow");
    expect(normalizedAutomationGuide).not.toContain("read_source_records");
    expect(normalizedAutomationGuide).not.toContain("get_knowledge_changes");

    const expectOrdered = (body: string, headings: string[]) => {
      let previous = -1;
      for (const heading of headings) {
        const position = body.indexOf(heading);
        expect(position).toBeGreaterThan(previous);
        previous = position;
      }
    };

    expectOrdered(activityDistiller, [
      "### 1. Initialize the run",
      "### 2. Read one working set",
      "### 3. Apply lifecycle semantics and discard noise",
      "### 4. Extract every retained record",
      "### 5. Reconcile the current record",
      "### 6. Audit and close the working set",
      "### 7. Report the run",
    ]);
    expectOrdered(diaryComposer, [
      "### 1. Initialize the run",
      "### 2. Freeze the change window",
      "### 3. Load exact changed evidence",
      "### 4. Derive the affected days",
      "### 5. Gather context for each affected day",
      "### 6. Reconcile each affected day",
      "### 7. Save the checkpoint and report",
    ]);
    expectOrdered(guidelineReviewer, [
      "### 1. Select the fixed change window",
      "### 2. Review each latest changed version",
      "### 3. Report through the harness",
    ]);

    for (const runtimeInstructions of [activityDistiller, diaryComposer, guidelineReviewer]) {
      expect(runtimeInstructions).toMatch(/^- \*\*a\.\*\*/m);
      expect(runtimeInstructions).not.toMatch(/^\s*\d+\.\s/m);
    }

    for (const detail of [
      "[[agents|root guide]]",
      "`cached_guidance_receipt`",
      "`read_source_records`",
      "no `limit`",
      "next_checkpoint",
      "`has_more`",
      "more than 30 days",
      "pruned deletion",
      "one at a time",
      "bounded working set",
      "do not extract subjects from a discarded record",
      "an audit gap is unfinished work, not failure",
      "only an actual error returned by a mutation",
      "replay is recovery after an actual failure",
      "`created`, `updated` and `archived` lists",
    ]) {
      expect(normalizedDistiller).toContain(detail);
    }
    const auditLoop = normalizedDistiller.indexOf("an audit gap is unfinished work, not failure");
    const checkpointWrite = normalizedDistiller.indexOf("replace the state body");
    expect(auditLoop).toBeGreaterThan(-1);
    expect(checkpointWrite).toBeGreaterThan(auditLoop);
    expect(normalizedDistiller).not.toContain("50 records");
    expect(normalizedDistiller).not.toContain("record_ref");
    expect(activityDistiller).not.toContain("Discarding a record does not discard its cast");
    expect(activityDistiller).not.toContain("automations/diary-composer/");

    for (const detail of [
      "[[agents|root guide]]",
      "[[about/diary/agents|diary guide]]",
      "`cached_guidance_receipt`",
      "`get_knowledge_changes`",
      "`next_page_token`",
      "`get_page_delta` once",
      "`comparison.complete` is false",
      "`page_delta_unavailable`",
      "do not calculate another diff",
      "`changed_at`, creation time, commit time and this run's date never choose a diary day",
      "a one-word correction contributes only its corrected meaning",
      "there is no recency cutoff",
      "`get_page_history`",
      "`browse_directory`",
      "`search_pages`",
      "next_cursor",
      "`created`, `updated` and `archived` lists",
    ]) {
      expect(normalizedComposer).toContain(detail);
    }
    expect(diaryComposer).not.toContain("Write connective prose");
    expect(diaryComposer).not.toContain("Repeated mention is not continuation");
    expect(diaryComposer).not.toContain("automations/activity-distiller/");
    for (const runtimeInstructions of [activityDistiller, diaryComposer, guidelineReviewer]) {
      expect(normalize(runtimeInstructions)).not.toContain("[[automations/agents|automation guide]]");
    }

    const nonAutomationGuides = [
      "../templates/default/about/AGENTS.md",
      "../templates/default/about/diary/AGENTS.md",
      "../templates/default/about/projects/AGENTS.md",
      "../templates/default/about/tasks/AGENTS.md",
      "../templates/default/companies/AGENTS.md",
      "../templates/default/events/AGENTS.md",
      "../templates/default/library/AGENTS.md",
      "../templates/default/meetings/AGENTS.md",
      "../templates/default/objects/AGENTS.md",
      "../templates/default/people/AGENTS.md",
      "../templates/default/places/AGENTS.md",
      "../templates/default/skills/AGENTS.md",
      "../templates/default/threads/AGENTS.md",
      "../templates/default/topics/AGENTS.md",
    ];
    const knowledgeGuides = (await Promise.all(nonAutomationGuides.map(
      async (path) => Bun.file(new URL(path, import.meta.url)).text(),
    ))).join("\n").toLowerCase();
    for (const detail of ["read_source_records", "next_checkpoint", "has_more", "pruned deletion"]) {
      expect(knowledgeGuides).not.toContain(detail);
    }
  });

  test("keeps directory summaries free of stale engagement and importance gates", () => {
    const summaries = Object.values(DEFAULT_DIRECTORY_PRESENTATIONS)
      .map(({ summary }) => summary.toLowerCase())
      .join("\n");

    for (const staleGate of [
      "worth remembering",
      "the owner took part in",
      "returns to them",
      "saved for recall",
      "individually meaningful",
    ]) {
      expect(summaries).not.toContain(staleGate);
    }

    expect(DEFAULT_DIRECTORY_PRESENTATIONS.companies!.summary).toContain("Identified organizations");
    expect(DEFAULT_DIRECTORY_PRESENTATIONS.events!.summary).toContain("Identified occasions");
    expect(DEFAULT_DIRECTORY_PRESENTATIONS.library!.summary).toContain("Identified external works");
    expect(DEFAULT_DIRECTORY_PRESENTATIONS.people!.summary).toContain("Identified people");
    expect(DEFAULT_DIRECTORY_PRESENTATIONS.places!.summary).toContain("Identified homes");
  });
});
