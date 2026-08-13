import { describe, expect, test } from "bun:test";
// Imported by path: eval/ is not a workspace package, so the name does not resolve
// here. Using the real schemas is the point — they are what a live write must pass.
import { createDirectorySchema, createPageSchema } from "../../../../packages/shared/src/index.ts";
import { corpusDirectory } from "../../../runner/corpus/integrity.ts";
import { loadWorldCorpus } from "../corpus.ts";
import { planSeed, summarise } from "./seed.ts";

const records = loadWorldCorpus(corpusDirectory("world-v1")).records;

/** What the default template already ships, so only genuinely new folders are created. */
const TEMPLATE_DIRECTORIES = [
  "about", "automations", "companies", "events", "library",
  "meetings", "objects", "people", "places", "topics",
];

describe("seeding world-v1 into the knowledge base", () => {
  test("every write satisfies the production schema", () => {
    // The seeder writes through the same repository the MCP tools use, so anything these
    // schemas reject would fail at run time against a live database. Checking all 240 here
    // is the substitute for a live run.
    const plan = planSeed(records, TEMPLATE_DIRECTORIES);
    for (const directory of plan.directories) {
      expect(() => createDirectorySchema.parse(directory)).not.toThrow();
    }
    for (const page of plan.pages) {
      expect(() => createPageSchema.parse(page)).not.toThrow();
    }
    expect(plan.pages).toHaveLength(240);
  });

  test("keeps upstream's own slug as the page path", () => {
    const plan = planSeed(records, TEMPLATE_DIRECTORIES);
    // `Gold.relevant` labels these slugs, so renaming them would throw away the one thing
    // that makes a later retrieval comparison possible.
    expect(plan.pages.map((page) => page.path).sort())
      .toEqual(records.map((record) => record.slug).sort());
    expect(plan.pages.some((page) => page.path === "people/adam-lopez-113")).toBe(true);
  });

  test("creates only the directories the template lacks, parents first", () => {
    const plan = planSeed(records, TEMPLATE_DIRECTORIES);
    // people/, companies/ and meetings/ already ship; concepts/ does not.
    expect(plan.directories.map((directory) => directory.path)).toEqual(["concepts"]);

    const fresh = planSeed(records, []);
    const depth = fresh.directories.map((directory) => directory.path.split("/").length);
    expect(depth).toEqual([...depth].sort((left, right) => left - right));
    expect(fresh.directories.map((directory) => directory.path).sort())
      .toEqual(["companies", "concepts", "meetings", "people"]);
  });

  test("carries the page body through untouched", () => {
    const plan = planSeed(records, TEMPLATE_DIRECTORIES);
    const bySlug = new Map(records.map((record) => [record.slug, record.markdown]));
    for (const page of plan.pages) expect(page.body_markdown).toBe(bySlug.get(page.path)!);
    // And still no answer key, since the loader stripped it before this ever ran.
    expect(plan.pages.some((page) => page.body_markdown.includes("_facts"))).toBe(false);
  });

  test("summarises with the page's first sentence", () => {
    expect(summarise("# Adam Lopez\n\n**Type:** person\n\nAdam Lopez is a senior engineer at Delta. He joined in 2022."))
      .toBe("Adam Lopez is a senior engineer at Delta.");
    // One line and within the column limit, whatever the prose does.
    for (const page of planSeed(records, TEMPLATE_DIRECTORIES).pages) {
      expect(page.summary).not.toMatch(/[\r\n]/);
      expect(page.summary.length).toBeGreaterThan(0);
      expect(page.summary.length).toBeLessThanOrEqual(320);
    }
  });

  test("seeds only the batches asked for, so a subset stays cheap", () => {
    const twoBatches = records.filter((record) => record.batch <= "batch-02");
    const plan = planSeed(twoBatches, TEMPLATE_DIRECTORIES);
    expect(plan.pages).toHaveLength(48);
  });
});
