import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CorpusRecordReader, loadCorpus } from "../../runner/corpus/records.ts";
import {
  LONGMEMEVAL_CASE_FILE,
  loadLongMemEvalCaseCorpus,
  publicLongMemEvalCase,
} from "./corpus.ts";
import type { LongMemEvalCase } from "./dataset.ts";

const CASE: LongMemEvalCase = {
  questionId: "question-1",
  questionType: "multi-session",
  question: "What is the sealed answer?",
  referenceAnswer: "This must stay sealed.",
  questionDate: "2023/05/30 (Tue) 12:00",
  abstention: false,
  sessions: [0, 1, 2].map((index) => ({
    id: `session-${index}`,
    date: `2023/05/2${index + 1} (Sun) 12:00`,
    turns: [
      { role: "user" as const, content: `User said ${index}.` },
      { role: "assistant" as const, content: `Assistant said ${index}.` },
    ],
  })),
  answerSessionIds: ["session-2"],
};

function materialize(): { directory: string; raw: string } {
  const directory = mkdtempSync(join(tmpdir(), "longmemeval-case-"));
  const publicCase = publicLongMemEvalCase(CASE, "a".repeat(40), 2);
  const raw = JSON.stringify(publicCase);
  writeFileSync(join(directory, LONGMEMEVAL_CASE_FILE), raw);
  return { directory, raw };
}

describe("LongMemEval agent-conversation corpus", () => {
  test("materializes sessions but seals the question, answer, and answer-session labels", () => {
    const { directory, raw } = materialize();
    const serialized = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(serialized).sort()).toEqual([
      "corpus_id", "schema_version", "sessions", "source_revision",
    ]);
    expect(raw).not.toContain(CASE.question);
    expect(raw).not.toContain(String(CASE.referenceAnswer));
    expect(raw).not.toContain("answerSessionIds");

    const corpus = loadLongMemEvalCaseCorpus(directory);
    expect(corpus.batches).toEqual(["batch-01", "batch-02"]);
    expect(corpus.records).toHaveLength(3);
    expect(corpus.records[0]?.type).toBe("agent-conversation");
    expect(corpus.records[0]?.markdown).toContain("# Agent conversation: User said 0.");
    expect(corpus.records[0]?.markdown).toContain("### Assistant — 2023/05/21 (Sun) 12:00");
  });

  test("serves each session through the production SourceRecordReader contract", async () => {
    const { directory } = materialize();
    expect(loadCorpus(directory).corpusId).toBe("longmemeval-v1-question-1");
    const reader = new CorpusRecordReader({ directory });
    const first = await reader.read({ limit: 100 });
    expect(first.records).toHaveLength(2);
    expect(first.has_more).toBe(false);
    expect(Object.keys(first.records[0]!).sort()).toEqual(["action", "markdown"]);
    expect(first.records[0]?.markdown).not.toContain("session-0");
    const second = await reader.read({ checkpoint: first.next_checkpoint, limit: 100 });
    expect(second.records).toHaveLength(1);
    expect(second.records[0]?.markdown).toContain("User said 2.");
  });

  test("closes large-conversation batches at the agent transport boundary", async () => {
    const directory = mkdtempSync(join(tmpdir(), "longmemeval-large-case-"));
    const large = {
      ...CASE,
      sessions: CASE.sessions.slice(0, 2).map((session, index) => ({
        ...session,
        turns: [{ role: "user" as const, content: `${index}-${"x".repeat(16_000)}` }],
      })),
      answerSessionIds: ["session-1"],
    };
    writeFileSync(join(directory, LONGMEMEVAL_CASE_FILE), JSON.stringify(
      publicLongMemEvalCase(large, "a".repeat(40), 10),
    ));
    const reader = new CorpusRecordReader({ directory });
    expect(reader.batches).toEqual(["batch-01", "batch-02"]);
    const first = await reader.read({ limit: 50 });
    expect(first.records).toHaveLength(1);
    expect(first.has_more).toBe(false);
    const second = await reader.read({ checkpoint: first.next_checkpoint, limit: 50 });
    expect(second.records).toHaveLength(1);
    expect(second.has_more).toBe(false);
  });
});
