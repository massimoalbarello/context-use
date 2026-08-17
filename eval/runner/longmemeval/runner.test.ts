import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { LONGMEMEVAL_DATASET } from "../../data/longmemeval-v1/manifest.ts";
import { longMemEvalRunnerInternals, scoreLongMemEval } from "./runner.ts";

describe("LongMemEval run reporting", () => {
  test("puts the benchmark date in the public question without a gold field", () => {
    const question = longMemEvalRunnerInternals.publicQuestion({
      questionId: "temporal-1",
      questionType: "temporal-reasoning",
      question: "How many days ago?",
      referenceAnswer: "18 days",
      questionDate: "2023/05/30 (Tue) 12:00",
      abstention: false,
      sessions: [{ id: "one", date: "2023/05/12", turns: [{ role: "user", content: "Event." }] }],
      answerSessionIds: ["one"],
    });
    expect(question.as_of_date).toBe("2023/05/30 (Tue) 12:00");
    expect(question.expected_output_type).toBe("time-qualified-answer");
    expect(Object.keys(question)).not.toContain("answer");
  });

  test("seals per-case gold and permits only read-only knowledge tools", () => {
    const publicResult = longMemEvalRunnerInternals.publicCaseResult({
      questionId: "sealed",
      questionType: "multi-session",
      questionDate: "2023/05/30",
      question: "What happened?",
      referenceAnswer: "secret",
      abstention: false,
      sessions: 40,
      batches: 4,
      recordsServed: 40,
      pages: 2,
      hypothesis: "answer",
      toolsUsed: ["search_pages", "read_page"],
    });
    expect(publicResult).not.toHaveProperty("referenceAnswer");
    // `get_page` used to be asserted here; no server has ever exposed it, and comparing
    // bare names against Claude Code's qualified ones voided every case on that harness.
    expect(longMemEvalRunnerInternals.forbiddenQaTools(["search_pages", "read_page"])).toEqual([]);
    expect(longMemEvalRunnerInternals.forbiddenQaTools([
      "ToolSearch", "mcp__context_use_eval__search_pages", "mcp__context_use_eval__read_page",
    ])).toEqual([]);
    expect(longMemEvalRunnerInternals.forbiddenQaTools([
      "read_source_records", "create_page", "command_execution", "web_search",
    ])).toEqual(["read_source_records", "create_page", "command_execution", "web_search"]);
  });

  test("counts void cases against end-to-end accuracy without sending them to the judge", async () => {
    const directory = mkdtempSync(join(tmpdir(), "longmemeval-run-"));
    writeFileSync(join(directory, "report.json"), JSON.stringify({
      runId: "test-run",
      benchmark: "longmemeval-v1",
      dataset: LONGMEMEVAL_DATASET,
      provider: "codex",
      sessionsPerBatch: 10,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      cases: [
        {
          questionId: "answered",
          questionType: "multi-session",
          questionDate: "2023/05/30",
          question: "Answered?",
          referenceAnswer: "yes",
          abstention: false,
          sessions: 40,
          batches: 4,
          recordsServed: 40,
          pages: 2,
          hypothesis: "yes",
        },
        {
          questionId: "void",
          questionType: "multi-session",
          questionDate: "2023/05/30",
          question: "Void?",
          referenceAnswer: "yes",
          abstention: false,
          sessions: 40,
          batches: 4,
          recordsServed: 30,
          pages: 1,
          voidReason: "ten records unread",
        },
      ],
    }));
    let judgeCalls = 0;
    const score = await scoreLongMemEval(directory, { judge: async () => {
      judgeCalls += 1;
      return {
        correct: true,
        response: "Yes",
        model: "test",
        provider: "codex",
        officialModel: false,
      };
    } });
    expect(judgeCalls).toBe(1);
    expect(score).toMatchObject({
      correct: 1,
      scored: 1,
      void: 1,
      accuracy: 0.5,
      judgeAccuracy: 1,
      model: "test",
      judgeProvider: "codex",
      officialModel: false,
    });
    expect(score.byType["multi-session"]).toEqual({
      correct: 1, scored: 1, void: 1, total: 2, accuracy: 0.5,
    });
    expect(JSON.parse(readFileSync(join(directory, "qa-score.json"), "utf8")).accuracy).toBe(0.5);
    expect(JSON.parse(readFileSync(join(directory, "qa-score-codex.json"), "utf8")).model).toBe("test");
  });
});
