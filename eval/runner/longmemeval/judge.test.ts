import { describe, expect, test } from "bun:test";
import type { AgentSession } from "../agent.ts";
import {
  judgeLongMemEvalAnswer,
  judgeLongMemEvalAnswerWithHarness,
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

  test("keeps the upstream multi-session prompt byte-for-byte", () => {
    expect(longMemEvalJudgePrompt({ ...BASE, questionType: "multi-session" }, "It took 18 days."))
      .toBe("I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. \n\nQuestion: When did it happen?\n\nCorrect Answer: 18 days\n\nModel Response: It took 18 days.\n\nIs the model response correct? Answer yes or no only.");
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
    expect(judged).toEqual({
      correct: true,
      response: "Yes",
      model: LONGMEMEVAL_JUDGE_MODEL,
      provider: "openai",
      officialModel: true,
    });
  });

  test("runs a separate tool-free harness session and records it as a non-official model", async () => {
    let session: AgentSession | undefined;
    const judged = await judgeLongMemEvalAnswerWithHarness(
      { ...BASE, questionType: "multi-session" },
      "It took 18 days.",
      {
        provider: "codex",
        runDirectory: "/tmp/longmemeval-judge-test",
        id: "judge-one",
        runSession: async (value) => { session = value; },
        finalAnswer: () => "Yes",
        toolsUsed: () => [],
      },
    );
    expect(session?.knowledgeTools).toBe(false);
    expect(session?.prompt).toBe(longMemEvalJudgePrompt(
      { ...BASE, questionType: "multi-session" },
      "It took 18 days.",
    ));
    expect(judged).toEqual({
      correct: true,
      response: "Yes",
      model: "codex-subscription",
      provider: "codex",
      officialModel: false,
    });
  });

  test("rejects a harness judge that invokes any tool", async () => {
    expect(judgeLongMemEvalAnswerWithHarness(
      { ...BASE, questionType: "multi-session" },
      "It took 18 days.",
      {
        provider: "codex",
        runDirectory: "/tmp/longmemeval-judge-test",
        id: "judge-tools",
        runSession: async () => {},
        finalAnswer: () => "Yes",
        toolsUsed: () => ["command_execution"],
      },
    )).rejects.toThrow(/forbidden tool action/);
  });
});
