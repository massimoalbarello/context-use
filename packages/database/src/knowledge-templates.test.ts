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
      "library",
      "meetings",
      "objects",
      "people",
      "places",
      "skills",
      "about/diary",
      "about/tasks",
    ]);
    expect(result.actions.filter(({ action }) => action === "create-guide")).toHaveLength(13);
    expect(state.createdDirectories).toEqual([]);
    expect(state.createdPages).toEqual([]);
    expect(formatTemplateResult(result)).toContain("+ create-directory library");
    expect(formatTemplateResult(result)).toContain("✓ Planned 25 changes; 0 conflicts.");
    expect(formatTemplateResult(result, true)).toContain("\u001B[32m+\u001B[0m create-directory");
  });

  test("updates bootstrap-owned guides while preserving locally edited guides", async () => {
    const state = repositories({
      directories: ["", "about", "about/diary", "about/tasks", "automations", "companies", "events", "library", "meetings", "objects", "people", "places", "skills"],
      pages: {
        agents: { body: "Legacy root.\n", actor: "context-use-bootstrap" },
        "people/agents": { body: "Owner rules.\n", actor: "owner-user-id" },
      },
    });
    const result = await reconcileKnowledgeTemplate(state.value, "default", true);

    expect(state.updatedPages).toEqual(["agents"]);
    expect(state.createdPages).toHaveLength(11);
    expect(result.actions).toContainEqual({
      action: "conflict",
      path: "people/agents",
      detail: "Preserve locally modified guide",
    });
    expect(formatTemplateResult(result)).toContain("Applied 12 changes; 1 conflict.");
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
      directories: ["", "about", "about/diary", "about/tasks", "automations", "companies", "events", "library", "meetings", "objects", "people", "places", "skills"],
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
    expect(formatTemplateResult(applied)).toContain("Applied 12 changes; 1 conflict.");
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
    const companies = await Bun.file(new URL("../templates/default/companies/AGENTS.md", import.meta.url)).text();
    const diary = await Bun.file(new URL("../templates/default/about/diary/AGENTS.md", import.meta.url)).text();
    const events = await Bun.file(new URL("../templates/default/events/AGENTS.md", import.meta.url)).text();
    const library = await Bun.file(new URL("../templates/default/library/AGENTS.md", import.meta.url)).text();
    const meetings = await Bun.file(new URL("../templates/default/meetings/AGENTS.md", import.meta.url)).text();
    const objects = await Bun.file(new URL("../templates/default/objects/AGENTS.md", import.meta.url)).text();
    const people = await Bun.file(new URL("../templates/default/people/AGENTS.md", import.meta.url)).text();
    const places = await Bun.file(new URL("../templates/default/places/AGENTS.md", import.meta.url)).text();
    const tasks = await Bun.file(new URL("../templates/default/about/tasks/AGENTS.md", import.meta.url)).text();
    const normalizedRoot = root.replaceAll(/\s+/g, " ");
    const normalizedAbout = about.replaceAll(/\s+/g, " ");
    const normalizedCompanies = companies.replaceAll(/\s+/g, " ");
    const normalizedEvents = events.replaceAll(/\s+/g, " ");
    const normalizedMeetings = meetings.replaceAll(/\s+/g, " ");
    const normalizedPeople = people.replaceAll(/\s+/g, " ");
    const normalizedPlaces = places.replaceAll(/\s+/g, " ");

    for (const guide of [
      "about/agents",
      "about/diary/agents",
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
    expect(normalizedAbout).toContain("default template defines only two subdirectories");
    expect(about).toContain("[[about/diary/agents|");
    expect(about).toContain("[[about/tasks/agents|");
    expect(normalizedAbout).toContain("Any other organization under `about/` is specific to the instance");
    expect(about).toContain("## Examples, not a schema");
    expect(normalizedAbout).toContain("not prescribed categories, reserved names or instructions to create folders");
    expect(about).not.toContain("chapters/");
    expect(about).not.toContain("projects/");
    expect(about).not.toContain("about/intro");
    expect(normalizedCompanies).toContain("part of a substantial effort");
    expect(diary).toContain("Current state remains in the diary");
    expect(diary).toContain("## Relationship timelines");
    expect(diary).toContain("timeline is curated history");
    expect(diary).not.toContain("frame or criteria");
    expect(diary).not.toContain("about/projects/");
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
    expect(normalizedPeople).toContain("current progress, ownership and next steps remain in the diary");
    expect(companies).toContain("material things the owner and company have done together");
    expect(normalizedCompanies).toContain("timeline is completed history, not pursuit state");
    expect(events).toContain("Index material relationship milestones");
    expect(normalizedPlaces).toContain("not a gazetteer of every location mentioned");
    expect(places).toContain("Current progress remains in the diary");
    expect(tasks).toContain("Beyond `intro`, there are no default names");
    expect(tasks).not.toContain("criteria");
    expect(tasks).not.toContain("<option>");
  });
});
