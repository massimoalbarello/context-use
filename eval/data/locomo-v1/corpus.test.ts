import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONVERSATION_WORKING_SET_BYTE_BUDGET } from "../../runner/corpus/types.ts";
import { loadCorpus } from "../../runner/corpus/records.ts";
import { LOCOMO_CASE_FILE, loadLocomoCaseCorpus, publicLocomoCase } from "./corpus.ts";
import type { LocomoConversation } from "./dataset.ts";

const REVISION = "3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376";

function conversation(sessionCount: number, turnText = "Hello there."): LocomoConversation {
  return {
    sampleId: "conv-26",
    speakerA: "Caroline",
    speakerB: "Melanie",
    sessions: Array.from({ length: sessionCount }, (_, index) => ({
      number: index + 1,
      dateTime: `1:5${index % 10} pm on 8 May, 2023`,
      timestamp: "2023-05-08T13:50:00.000Z",
      day: "2023-05-08",
      turns: [
        { speaker: "Caroline", diaId: `D${index + 1}:1`, text: turnText },
        { speaker: "Melanie", diaId: `D${index + 1}:2`, text: "Hi!", imageCaption: "a dog on a wall" },
      ],
    })),
    questions: [{
      id: "conv-26-q001",
      index: 0,
      category: 4,
      categoryName: "single-hop",
      question: "What did she say?",
      referenceAnswer: "hello",
      evidence: ["D1:1"],
      adversarial: false,
    }],
  };
}

function writeCase(entry: LocomoConversation, sessionsPerBatch = 10): string {
  const directory = mkdtempSync(join(tmpdir(), "locomo-case-"));
  writeFileSync(
    join(directory, LOCOMO_CASE_FILE),
    JSON.stringify(publicLocomoCase(entry, REVISION, sessionsPerBatch)),
  );
  return directory;
}

describe("the agent-facing case", () => {
  test("carries no question, answer, category or evidence", () => {
    const serialized = JSON.stringify(publicLocomoCase(conversation(2), REVISION, 10));
    for (const leak of ["What did she say?", "hello", "single-hop", "D1:1", "referenceAnswer"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  test("renders both speakers, the session date and the image caption", () => {
    const corpus = loadLocomoCaseCorpus(writeCase(conversation(1)));
    const markdown = corpus.records[0]!.markdown;
    expect(markdown).toContain("# Conversation between Caroline and Melanie");
    expect(markdown).toContain("**Session date:** 1:50 pm on 8 May, 2023");
    expect(markdown).toContain("### Caroline — 1:50 pm on 8 May, 2023");
    expect(markdown).toContain("[Image: a dog on a wall] Hi!");
  });

  test("is discovered by the shared corpus loader from its own descriptor", () => {
    const corpus = loadCorpus(writeCase(conversation(3)));
    expect(corpus.corpusId).toBe("locomo-v1-conv-26");
    expect(corpus.records).toHaveLength(3);
    expect(corpus.records[0]!.type).toBe("conversation-session");
  });

  test("gives every session its own record, in upstream's order", () => {
    const corpus = loadLocomoCaseCorpus(writeCase(conversation(3)));
    expect(corpus.records.map((record) => record.slug))
      .toEqual(["session-01", "session-02", "session-03"]);
  });
});

describe("batching", () => {
  test("closes a batch at the session ceiling", () => {
    const corpus = loadLocomoCaseCorpus(writeCase(conversation(7), 3));
    expect(corpus.batches).toEqual(["batch-01", "batch-02", "batch-03"]);
    expect(corpus.records.filter((record) => record.batch === "batch-01")).toHaveLength(3);
  });

  test("closes a batch at the transport ceiling before the session ceiling", () => {
    // Each session here is far larger than a real one, so bytes bind first.
    const large = conversation(6, "x".repeat(9_000));
    const corpus = loadLocomoCaseCorpus(writeCase(large, 100));
    expect(corpus.batches.length).toBeGreaterThan(1);
    for (const batch of corpus.batches) {
      const bytes = corpus.records
        .filter((record) => record.batch === batch)
        .reduce((total, record) => total
          + Buffer.byteLength(JSON.stringify({ action: "added", markdown: record.markdown }), "utf8") + 1, 0);
      const records = corpus.records.filter((record) => record.batch === batch).length;
      // The materializer keeps one logical session whole; the production planner owns any
      // later turn-boundary segmentation into fresh-session working sets.
      if (records > 1) expect(bytes).toBeLessThanOrEqual(CONVERSATION_WORKING_SET_BYTE_BUDGET);
    }
  });

  test("keeps every logical session whole before production working-set planning", () => {
    const corpus = loadLocomoCaseCorpus(writeCase(conversation(25), 4));
    const slugs = corpus.records.map((record) => record.slug);
    expect(new Set(slugs).size).toBe(25);
  });

  test("rejects a nonsensical batch size", () => {
    expect(() => publicLocomoCase(conversation(1), REVISION, 0)).toThrow(/between 1 and 100/);
    expect(() => publicLocomoCase(conversation(1), REVISION, 101)).toThrow(/between 1 and 100/);
  });
});
