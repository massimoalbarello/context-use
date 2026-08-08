import { describe, expect, test } from "bun:test";
import { loadCorpus } from "../apps/server/src/corpus-records.ts";
import {
  CORPUS_DIRECTORY,
  CORPUS_UPSTREAM,
  corpusIsUnchanged,
  diffCorpus,
  readCorpusLock,
} from "./corpus-integrity.ts";

/**
 * The corpus is the experiment's fixed input. If it changes, every score measured
 * against it becomes incomparable, so these assertions are deliberately exact.
 */
describe("vendored evaluation corpus", () => {
  test("is byte-identical to what was vendored", () => {
    const difference = diffCorpus();
    expect(difference).toEqual({ changed: [], missing: [], unexpected: [] });
    expect(corpusIsUnchanged(difference)).toBe(true);
  });

  test("records the exact upstream commit it came from", () => {
    const lock = readCorpusLock();
    expect(lock.upstream).toEqual(CORPUS_UPSTREAM);
    expect(CORPUS_UPSTREAM.commit).toMatch(/^[a-f0-9]{40}$/);
  });

  test("reproduces every upstream note and meeting hash while loading", () => {
    // loadCorpus throws on any mismatch, so reaching the assertions is the check.
    const corpus = loadCorpus(CORPUS_DIRECTORY);
    expect(corpus.corpusId).toBe("amara-life-v1");
    expect(corpus.license).toBe("MIT");
  });

  test("serves every one of the 418 upstream items exactly once", () => {
    const carried = loadCorpus(CORPUS_DIRECTORY).records.flatMap((record) => record.itemSlugs);
    expect(carried).toHaveLength(418);
    expect(new Set(carried).size).toBe(418);
  });

  test("serves one record per manifest item", () => {
    const corpus = loadCorpus(CORPUS_DIRECTORY);
    const counts = corpus.records.reduce<Record<string, number>>((totals, record) => {
      totals[record.type] = (totals[record.type] ?? 0) + 1;
      return totals;
    }, {});
    expect(counts).toEqual({ slack: 300, email: 50, note: 40, "calendar-event": 20, meeting: 8 });
    expect(corpus.records).toHaveLength(418);
    for (const record of corpus.records) expect(record.itemSlugs).toEqual([record.slug]);
  });

  test("adds no threading header of its own", () => {
    const corpus = loadCorpus(CORPUS_DIRECTORY);
    // `thread_id` is floor(index / 2) over independently drawn counterparties and
    // `thread_ts` groups every tenth Slack message across four rotating channels, while
    // upstream's prose generator wrote every item from metadata alone. Promoting either
    // into the body would invite a link between messages that have nothing to do with
    // one another. Upstream's own subject line still reads "Thread thr-0000 re Ravi" and
    // is served verbatim, because the subject is the message's own content.
    for (const record of corpus.records) {
      if (record.type !== "email" && record.type !== "slack") continue;
      expect(record.markdown).not.toMatch(/\*\*(Thread|In thread|In-Reply-To|Reply to):\*\*/i);
    }
  });

  test("never revises an item it has already served", () => {
    const corpus = loadCorpus(CORPUS_DIRECTORY);
    expect(corpus.records.every((record) => record.action === "added")).toBe(true);
    expect(new Set(corpus.records.map((record) => record.slug)).size).toBe(corpus.records.length);
  });

  test("holds the expected shape across days", () => {
    const corpus = loadCorpus(CORPUS_DIRECTORY);
    expect(corpus.days).toHaveLength(47);
    expect(corpus.days[0]).toBe("2026-01-25");
    expect(corpus.days.at(-1)).toBe("2026-04-20");

    const dense = corpus.records.filter((record) => record.day >= "2026-04-13");
    expect(new Set(dense.map((record) => record.day)).size).toBe(8);
  });

  test("gives every record a usable timestamp and body", () => {
    for (const record of loadCorpus(CORPUS_DIRECTORY).records) {
      expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(record.day).toBe(record.timestamp.slice(0, 10));
      expect(record.markdown.trim().length).toBeGreaterThan(0);
    }
  });
});
