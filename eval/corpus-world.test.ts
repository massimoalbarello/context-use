import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CorpusRecordReader, loadCorpus, windowRecords } from "./corpus-records.ts";
import {
  CORPUS_UPSTREAM,
  corpusDirectory,
  corpusIsUnchanged,
  diffCorpus,
  readCorpusLock,
} from "./corpus-integrity.ts";

const DIRECTORY = corpusDirectory("world-v1");

/**
 * `world-v1` is the experiment's fixed input and its `_facts` blocks are the answer key
 * behind every question in `qa/world-v1`. Both properties are asserted exactly.
 */
describe("vendored world-v1 corpus", () => {
  test("is byte-identical to what was vendored", () => {
    const difference = diffCorpus("world-v1");
    expect(difference).toEqual({ changed: [], missing: [], unexpected: [] });
    expect(corpusIsUnchanged(difference)).toBe(true);
  });

  test("records the exact upstream commit it came from", () => {
    const lock = readCorpusLock("world-v1");
    expect(lock.upstream).toEqual(CORPUS_UPSTREAM["world-v1"]);
    expect(CORPUS_UPSTREAM["world-v1"].commit).toMatch(/^[a-f0-9]{40}$/);
    expect(CORPUS_UPSTREAM["world-v1"].path).toBe("eval/data/world-v1");
  });

  test("serves all 240 pages and neither of the two non-content files", () => {
    const corpus = loadCorpus(DIRECTORY);
    expect(corpus.corpusId).toBe("world-v1");
    expect(corpus.records).toHaveLength(240);
    expect(new Set(corpus.records.map((record) => record.slug)).size).toBe(240);

    const counts = corpus.records.reduce<Record<string, number>>((totals, record) => {
      totals[record.type] = (totals[record.type] ?? 0) + 1;
      return totals;
    }, {});
    expect(counts).toEqual({ person: 80, company: 80, meeting: 50, concept: 30 });

    // `_ledger.json` is generation metadata and `world.html` is a rendered explorer.
    // Both are vendored because the corpus is copied verbatim; neither is content.
    for (const record of corpus.records) {
      expect(record.slug).not.toContain("_ledger");
      expect(record.slug).not.toContain("world.html");
    }
  });

  test("never lets a _facts value reach a served record", () => {
    const corpus = loadCorpus(DIRECTORY);
    const bodies = corpus.records.map((record) => record.markdown).join("\n");
    expect(bodies).not.toContain("_facts");

    // Not just the key. What matters is that the loader *adds* nothing from `_facts`:
    // a body may legitimately carry `[Acme Labs](companies/acme-labs-50)`, because
    // upstream wrote that reference into its own prose and it is served verbatim. The
    // leak to catch is a `_facts` value the prose does not already state — a relationship
    // list promoted into the body would hand over the answer to that page's question.
    const shards = readdirSync(DIRECTORY)
      .filter((name) => name.endsWith(".json") && name !== "_ledger.json")
      .map((name) => JSON.parse(readFileSync(join(DIRECTORY, name), "utf8")) as {
        slug: string; type: string; title: string; compiled_truth: string;
        timeline: string | string[]; _facts: Record<string, unknown>;
      });
    const bySlug = new Map(corpus.records.map((record) => [record.slug, record.markdown]));

    let checked = 0;
    const leaked: string[] = [];
    for (const shard of shards) {
      const body = bySlug.get(shard.slug)!;
      const timeline = Array.isArray(shard.timeline) ? shard.timeline.join("\n") : shard.timeline ?? "";
      // `_facts` restates `slug` and `type`, which are public fields in their own right;
      // the renderer writes the public ones and has no access to the `_facts` copies.
      const publicFields = `${shard.type}\n${shard.title}\n${shard.compiled_truth}\n${timeline}`;
      const values = Object.values(shard._facts).flatMap((value) =>
        Array.isArray(value) ? value.map(String) : [String(value)]);
      for (const value of values) {
        if (publicFields.includes(value)) continue;
        checked += 1;
        if (body.includes(value)) leaked.push(`${shard.slug} leaked ${JSON.stringify(value)}`);
      }
    }
    expect(leaked).toEqual([]);
    // The assertion is worthless if `_facts` merely restates the prose everywhere.
    expect(checked).toBeGreaterThan(200);
  });

  test("holds no chronology of its own, so it is batched rather than dated", () => {
    const corpus = loadCorpus(DIRECTORY);
    // Meeting shards carry a `_facts.date`, but 190 of 240 pages are not dated events.
    // Giving them a day would fabricate a chronology the corpus does not have.
    expect(corpus.days).toEqual([]);
    for (const record of corpus.records) {
      expect(record.day).toBeUndefined();
      expect(record.timestamp).toBeUndefined();
    }
    expect(() => windowRecords(corpus, "dense")).toThrow(/selects a span of days/);
  });

  test("gives every batch the same proportional mix", () => {
    const corpus = loadCorpus(DIRECTORY);
    expect(corpus.batches).toHaveLength(10);
    expect(corpus.batches[0]).toBe("batch-01");
    expect(corpus.batches.at(-1)).toBe("batch-10");

    // Sorted by slug the corpus runs companies, concepts, meetings, then people, so a
    // contiguous slice would serve every company before the people who work at them.
    for (const batch of corpus.batches) {
      const records = corpus.records.filter((record) => record.batch === batch);
      const counts = records.reduce<Record<string, number>>((totals, record) => {
        totals[record.type] = (totals[record.type] ?? 0) + 1;
        return totals;
      }, {});
      expect(counts).toEqual({ company: 8, concept: 3, meeting: 5, person: 8 });
    }
  });

  test("serves one batch per run and advances to the next", async () => {
    const reader = new CorpusRecordReader({ directory: DIRECTORY });
    expect(reader.batches).toHaveLength(10);

    let checkpoint: string | undefined;
    let runs = 0;
    let served = 0;
    for (;;) {
      const result = await reader.read(checkpoint ? { checkpoint } : {});
      checkpoint = result.next_checkpoint;
      served += result.records.length;
      if (!result.has_more) {
        runs += 1;
        if (result.records.length === 0) break;
      }
      if (runs > 12) throw new Error("reader did not terminate");
    }
    // Ten batches, then one exhausted read that returns nothing.
    expect(runs).toBe(11);
    expect(served).toBe(240);
  });

  test("serves prose with upstream's own inline entity references intact", async () => {
    const reader = new CorpusRecordReader({ directory: DIRECTORY });
    const { records } = await reader.read({ limit: 100 });
    const expectedPerson = loadCorpus(DIRECTORY).records.find((record) => record.type === "person")!;
    const person = records.find((record) => record.markdown === expectedPerson.markdown)!;
    expect(person).toBeDefined();
    expect(person.action).toBe("added");
    expect(person.markdown).toMatch(/^# /);
    // Rewriting these would modify the corpus and disadvantage any system built to read
    // them, so they are served exactly as upstream wrote them.
    // `markdown` is nullable on the contract because a deletion carries no body; a fixed
    // corpus only ever adds, so every record here has one.
    expect(records.some((record) =>
      /\[[^\]]+\]\((people|companies)\/[a-z0-9-]+\)/.test(record.markdown ?? ""))).toBe(true);
  });
});
