import { describe, expect, test } from "bun:test";
import {
  judgeLongMemEvalAnswer,
  longMemEvalJudgePrompt,
  LONGMEMEVAL_JUDGE_MODEL,
} from "./judge.ts";

const BASE = {
  question: "When did it happen?",
  referenceAnswer: "18 days",
  abstention: false,
} as const;

describe("official-compatible LongMemEval QA judge", () => {
  test("uses the benchmark's question-type-specific rubric", () => {
    expect(longMemEvalJudgePrompt({ ...BASE, questionType: "temporal-reasoning" }, "19 days"))
      .toContain("do not penalize off-by-one errors");
    expect(longMemEvalJudgePrompt({ ...BASE, questionType: "knowledge-update" }, "new and old"))
      .toContain("previous information along with an updated answer");
    expect(longMemEvalJudgePrompt({ ...BASE, questionType: "single-session-preference" }, "personal"))
      .toContain("rubric for desired personalized response");
    expect(longMemEvalJudgePrompt({ ...BASE, questionType: "multi-session", abstention: true }, "unknown"))
      .toContain("correctly identifies the question as unanswerable");
  });

  test("pins the official model and interprets its yes/no response", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const judged = await judgeLongMemEvalAnswer(
      { ...BASE, questionType: "multi-session" },
      "It happened in 18 days.",
      {
        apiKey: "test-key",
        fetcher: (async (_input: string | URL | Request, init?: RequestInit) => {
          requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({ choices: [{ message: { content: "Yes" } }] });
        }) as typeof fetch,
      },
    );
    expect(requestBody?.model).toBe(LONGMEMEVAL_JUDGE_MODEL);
    expect(requestBody?.temperature).toBe(0);
    expect(requestBody?.max_tokens).toBe(10);
    expect(judged).toEqual({ correct: true, response: "Yes", model: LONGMEMEVAL_JUDGE_MODEL });
  });
});
