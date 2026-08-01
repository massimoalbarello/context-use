import { describe, expect, test } from "bun:test";
import type { TemplateRepositories } from "./knowledge-templates.ts";
import { formatTemplateResult, reconcileKnowledgeTemplate } from "./knowledge-templates.ts";

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
  "about/diary",
  "about/projects",
  "about/tasks",
  "automations/activity-distiller",
];

function repositories(options: {
  directories?: string[];
  directorySummaries?: Record<string, string>;
  pages?: Record<string, {
    body: string;
    actor: string;
    archived?: boolean;
    title?: string;
    summary?: string;
  }>;
} = {}) {
  const directoryRecords = new Map((options.directories ?? [""]).map((path, index) => [path, {
    id: `directory-${index}`,
    current_path: path,
    version_number: 1,
    title: path ? path.split("/").at(-1)! : "Knowledge",
    summary: options.directorySummaries?.[path] ?? "Existing directory summary.",
    intro_markdown: `Existing introduction for ${path || "root"}.`,
  }]));
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
    actor: page.actor,
  }]));
  const createdDirectories: string[] = [];
  const createdDirectoryInputs: Array<{ path: string; title: string; summary: string; intro_markdown: string }> = [];
  const updatedDirectories: string[] = [];
  const updatedDirectoryInputs: Array<{ title: string; summary: string; intro_markdown: string; expected_version_number: number }> = [];
  const createdPages: string[] = [];
  const createdPageInputs: Array<{ path: string; title: string; summary: string; body_markdown: string }> = [];
  const updatedPages: string[] = [];
  const updatedPageInputs: Array<{ path: string; title: string; summary: string; body_markdown: string }> = [];
  const value = {
    directories: {
      async getByPath(path: string) {
        return directoryRecords.get(path) ?? null;
      },
      async create(input: { path: string; title: string; summary: string; intro_markdown: string }) {
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
      async update(id: string, input: { title: string; summary: string; intro_markdown: string; expected_version_number: number }) {
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
  };
}

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
      "about/diary",
      "about/projects",
      "about/tasks",
      "automations/activity-distiller",
    ]);
    expect(result.actions.filter(({ action }) => action === "create-guide")).toHaveLength(14);
    expect(result.actions.filter(({ action }) => action === "create-page").map(({ path }) => path)).toEqual([
      "automations/activity-distiller/instructions",
      "automations/activity-distiller/state",
    ]);
    expect(state.createdDirectories).toEqual([]);
    expect(state.createdPages).toEqual([]);
    expect(formatTemplateResult(result)).toContain("+ create-directory library");
    expect(formatTemplateResult(result)).toContain("✓ Planned 30 changes; 0 conflicts.");
    expect(formatTemplateResult(result, true)).toContain("\u001B[32m+\u001B[0m create-directory");
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
    expect(state.updatedDirectoryInputs.every(({ intro_markdown }) => intro_markdown.startsWith("Existing introduction"))).toBe(true);
    expect(result.actions).toContainEqual({
      action: "update-directory",
      path: "library",
      detail: "Add template summary for library",
    });
    expect(formatTemplateResult(result)).toContain("Applied 18 changes; 0 conflicts.");
  });

  test("uses authored presentation when creating template directories", async () => {
    const state = repositories();

    await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(state.createdDirectoryInputs).toContainEqual({
      path: "places",
      title: "Places",
      summary: "Locations that matter because the owner returns to them, makes decisions about them, or connects them to several parts of the knowledge base.",
      intro_markdown: "",
    });
    expect(state.createdDirectoryInputs.every(({ summary }) => summary.length > 0)).toBe(true);
    expect(state.createdPageInputs.find(({ path }) => path === "automations/activity-distiller/instructions"))
      .toMatchObject({
        title: "Activity distiller",
        summary: "Instructions for reconciling one bounded batch of connected activity into concise canonical knowledge.",
        body_markdown: expect.stringContaining("Call `read_source_records` exactly once"),
      });
    expect(state.createdPageInputs.find(({ path }) => path === "automations/activity-distiller/state"))
      .toMatchObject({
        title: "Activity distiller state",
        summary: "The current opaque source checkpoint for the activity distiller.",
        body_markdown: "# Activity distiller state\n\n**Checkpoint:** _none_\n",
      });
  });

  test("updates untouched instructions but never overwrites live checkpoint state", async () => {
    const state = repositories({
      directories: DEFAULT_DIRECTORY_PATHS,
      pages: {
        "automations/activity-distiller/instructions": {
          title: "Activity distiller",
          summary: "Instructions for reconciling one bounded batch of connected activity into concise canonical knowledge.",
          body: "Old template instructions.\n",
          actor: "context-use-template/default",
        },
        "automations/activity-distiller/state": {
          title: "Activity distiller state",
          summary: "The current opaque source checkpoint for the activity distiller.",
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

    const result = await reconcileKnowledgeTemplate(state.value, "default", true, true);

    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "automations/activity-distiller/instructions",
      detail: "Preserve locally modified template page",
    });
    expect(state.updatedPages).not.toContain("automations/activity-distiller/instructions");
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
    expect(state.createdPages).toHaveLength(14);
    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "people/agents",
      detail: "Preserve locally modified guide",
    });
    expect(formatTemplateResult(result)).toContain("Applied 15 changes; 1 conflict.");
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
    expect(formatTemplateResult(applied)).toContain("Applied 15 changes; 1 conflict.");
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

  test("keeps global conventions in the root and local structure in directory guides", async () => {
    const root = await Bun.file(new URL("../templates/default/AGENTS.md", import.meta.url)).text();
    const about = await Bun.file(new URL("../templates/default/about/AGENTS.md", import.meta.url)).text();
    const automations = await Bun.file(new URL("../templates/default/automations/AGENTS.md", import.meta.url)).text();
    const companies = await Bun.file(new URL("../templates/default/companies/AGENTS.md", import.meta.url)).text();
    const diary = await Bun.file(new URL("../templates/default/about/diary/AGENTS.md", import.meta.url)).text();
    const events = await Bun.file(new URL("../templates/default/events/AGENTS.md", import.meta.url)).text();
    const library = await Bun.file(new URL("../templates/default/library/AGENTS.md", import.meta.url)).text();
    const meetings = await Bun.file(new URL("../templates/default/meetings/AGENTS.md", import.meta.url)).text();
    const objects = await Bun.file(new URL("../templates/default/objects/AGENTS.md", import.meta.url)).text();
    const people = await Bun.file(new URL("../templates/default/people/AGENTS.md", import.meta.url)).text();
    const places = await Bun.file(new URL("../templates/default/places/AGENTS.md", import.meta.url)).text();
    const projects = await Bun.file(new URL("../templates/default/about/projects/AGENTS.md", import.meta.url)).text();
    const skills = await Bun.file(new URL("../templates/default/skills/AGENTS.md", import.meta.url)).text();
    const tasks = await Bun.file(new URL("../templates/default/about/tasks/AGENTS.md", import.meta.url)).text();
    const activityDistiller = await Bun.file(new URL("../templates/default/_pages/activity-distiller/instructions.md", import.meta.url)).text();
    const normalizedRoot = root.replaceAll(/\s+/g, " ");
    const normalizedRootLower = normalizedRoot.toLowerCase();
    const normalizedAbout = about.replaceAll(/\s+/g, " ");
    const normalizedCompanies = companies.replaceAll(/\s+/g, " ");
    const normalizedEvents = events.replaceAll(/\s+/g, " ");
    const normalizedMeetings = meetings.replaceAll(/\s+/g, " ");
    const normalizedPeople = people.replaceAll(/\s+/g, " ");
    const normalizedPlaces = places.replaceAll(/\s+/g, " ");
    const normalizedProjects = projects.replaceAll(/\s+/g, " ");
    const allDefaultGuides = [
      root,
      about,
      automations,
      companies,
      diary,
      events,
      library,
      meetings,
      objects,
      people,
      places,
      projects,
      skills,
      tasks,
    ]
      .join("\n")
      .toLowerCase();

    for (const guide of [
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
    ]) {
      expect(root).toContain(`[[${guide}|`);
    }
    expect(root).toContain("This guide defines only conventions that apply everywhere");
    expect(normalizedRoot).toContain("only place that says where ongoing work currently stands");
    expect(normalizedRoot).toContain("curated, dated index of completed history");
    expect(root).toContain("A deliberately public-safe page still");
    expect(root).not.toContain("people/<first-last>");
    expect(root).not.toContain("meetings/<YYYY>");
    expect(normalizedAbout).toContain("default template defines only three subdirectories");
    expect(about).toContain("[[about/diary/agents|");
    expect(about).toContain("[[about/projects/agents|");
    expect(about).toContain("[[about/tasks/agents|");
    expect(normalizedAbout).toContain("Any other organization under `about/` is specific to the instance");
    expect(about).toContain("## Examples, not a schema");
    expect(normalizedAbout).toContain("not prescribed categories, reserved names or instructions to create folders");
    expect(about).not.toContain("chapters/");
    expect(about).not.toContain("about/intro");
    expect(normalizedCompanies).toContain("part of a substantial effort");
    expect(diary).toContain("Current state remains in the diary");
    expect(diary).toContain("## Relationship timelines");
    expect(diary).toContain("timeline is curated history");
    expect(diary).not.toContain("frame or criteria");
    expect(diary).toContain("how automation-owned companion pages are maintained");
    expect(diary).toContain("A rerun rewrites its whole day page");
    expect(diary).toContain("Operational metadata and execution state never belong in the diary");
    expect(normalizedEvents).toContain("what changed the owner's mind at the event");
    expect(library).toContain("library/<meaningful-slug>/");
    expect(library).toContain("description shown for the work in the parent `library/` index");
    expect(library).toContain("Format is metadata, never a directory");
    expect(library).toContain("preserved exactly when their words are known");
    expect(library).toContain("never infer a summary from the title alone");
    expect(meetings).toContain("## Commitments made");
    expect(normalizedMeetings).toContain("The owner's read at the time");
    expect(meetings).toContain("Add this meeting to each participant's");
    expect(meetings).not.toContain("## Follow-ups");
    expect(objects).toContain("not a product catalogue or an inventory");
    expect(objects).toContain("Current progress remains in the diary");
    expect(people).toContain("company, meeting, link, handle");
    expect(people).toContain("timeline` is the sole reverse index");
    expect(people).toContain("material things the owner and person have done together");
    expect(people).toContain("favourite hangouts or gadgets");
    expect(people).toContain("independently meets its creation");
    expect(people).not.toContain("immigration");
    expect(companies).toContain("material things the owner and company have done together");
    expect(normalizedCompanies).toContain("timeline is completed history, not pursuit state");
    expect(events).toContain("Index material relationship milestones");
    expect(normalizedPlaces).toContain("not a gazetteer of every location mentioned");
    expect(places).toContain("Current progress remains in the diary");
    expect(tasks).toContain("Beyond `intro`, there are no default names");
    expect(tasks).toContain("which can resolve or close");
    expect(tasks).toContain("[[about/projects/agents|projects]]");
    expect(tasks).not.toContain("criteria");
    expect(tasks).not.toContain("<option>");
    expect(projects).toContain("about/projects/<slug>/");
    expect(normalizedProjects).toContain("A deliverable can support a project without defining it");
    expect(projects).toContain("It is not a commit log or exhaustive release log");
    expect(automations).toContain("exactly one stable");
    expect(automations).toContain("canonical description of that automation");
    expect(automations).toContain("Workflow-specific tool calls");
    expect(automations).toContain("follows [[agents#where-a-page-belongs|the root");
    expect(activityDistiller).toContain("Call `read_source_records` exactly once");
    expect(activityDistiller).toContain("call `prepare_knowledge_write` for the exact target");
    expect(activityDistiller).toContain("rewrite the complete existing activity-distiller page");
    expect(activityDistiller).toContain("owner `log` merely to link an automation page");
    expect(activityDistiller).toContain("replace the whole state page with the returned checkpoint");
    expect(activityDistiller).not.toContain("drain");
    expect(normalizedRootLower).toContain("reconcile; never append by default");
    expect(normalizedRootLower).toContain("as concise as possible, but no more concise than the truth allows");
    const activityDistillerLower = activityDistiller.toLowerCase();
    for (const automationSpecificDetail of [
      "nango",
      "activity-distiller",
      "read_source_records",
      "record_ref",
      "next_checkpoint",
      "has_more",
      "preceding 30 days",
      "source record",
      "bounded batch",
      "multi-source activity distiller",
      "repository owner, email domain",
      "participant field",
      "pipeline proposals",
      "pruned deletion",
    ]) {
      expect(allDefaultGuides).not.toContain(automationSpecificDetail);
    }
    for (const requiredInstructionDetail of [
      "activity-distiller",
      "read_source_records",
      "record_ref",
      "next_checkpoint",
      "has_more",
      "preceding 30 days",
      "source evidence",
      "one bounded batch",
      "pruned deletion",
      "repository or burst of activity",
      "participant lists, handles, domains",
    ]) {
      expect(activityDistillerLower).toContain(requiredInstructionDetail);
    }
    for (const instanceSpecificExample of [
      "companies/openai/",
      "granola-intro-call",
      "karpathy-software-is-changing-again",
      "blue-land-rover",
      "the-old-vicarage",
      "london-ai-summit",
      "*london · one line framing the day*",
    ]) {
      expect(allDefaultGuides).not.toContain(instanceSpecificExample);
    }
  });
});
