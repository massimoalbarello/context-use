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
    expect(corpus.records).toHaveLength(418);
  });

  test("holds the expected shape across days and sources", () => {
    const corpus = loadCorpus(CORPUS_DIRECTORY);
    const counts = corpus.records.reduce<Record<string, number>>((totals, record) => {
      totals[record.type] = (totals[record.type] ?? 0) + 1;
      return totals;
    }, {});
    expect(counts).toEqual({ slack: 300, email: 50, note: 40, "calendar-event": 20, meeting: 8 });

    expect(corpus.days).toHaveLength(47);
    expect(corpus.days[0]).toBe("2026-01-25");
    expect(corpus.days.at(-1)).toBe("2026-04-20");

    const dense = corpus.records.filter((record) => record.day >= "2026-04-13");
    expect(dense).toHaveLength(379);
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
