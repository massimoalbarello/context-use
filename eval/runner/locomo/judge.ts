import { mkdir } from "node:fs/promises";
import { z } from "zod";
import type { LocomoCategory } from "../../data/locomo-v1/dataset.ts";
import {
  agentFinalAnswer,
  agentToolsUsed,
  runAgentSession,
  type EvalProvider,
} from "../agent.ts";
import { officialReference } from "./metrics.ts";

/**
 * An optional yes/no judge, reported beside the two deterministic scorers and never
 * folded into them.
 *
 * LoCoMo defines no official judge — its published metric is the token F1 in `metrics.ts`
 * — so this prompt is this repository's, and it is labelled that way everywhere it
 * appears. It exists because the deterministic metrics measure answer *shape* as much as
 * answer *content*: a correct reply that names one extra true fact loses precision, and a
 * knowledge base that answers in prose is penalised for prose. The memory-system papers
 * that report an LLM judge on LoCoMo are measuring the second thing, and a comparison that
 * only had F1 could not tell a retrieval failure from a verbosity penalty.
 *
 * The isolation is LongMemEval's, for the same reasons: no Context Use MCP, and any tool
 * action voids the judgement rather than being tolerated.
 */

/** Pinned so a judge does not move when the model under test does. */
export const LOCOMO_OPENAI_JUDGE_MODEL = "gpt-4o-2024-08-06";
export type LocomoJudgeProvider = EvalProvider | "openai";

export type LocomoJudgement = {
  correct: boolean;
  response: string;
  model: string;
  provider: LocomoJudgeProvider;
};

export type JudgedLocomoAnswer = {
  category: LocomoCategory;
  question: string;
  referenceAnswer: string;
};

export function locomoJudgePrompt(entry: JudgedLocomoAnswer, hypothesis: string): string {
  if (entry.category === 5) {
    return `I will give you a question that the conversation does not actually answer, the claim someone might wrongly infer, and a response from a model. Please answer yes if the model declines to answer — saying the information is not mentioned, not available, or not in what it knows. Answer no if the model asserts the claim or any other substantive answer.\n\nQuestion: ${entry.question}\n\nUnsupported claim: ${entry.referenceAnswer}\n\nModel Response: ${hypothesis}\n\nDoes the model correctly decline to answer? Answer yes or no only.`;
  }
  const reference = officialReference(entry.referenceAnswer, entry.category);
  if (entry.category === 1) {
    return `I will give you a question, a correct answer that has several parts, and a response from a model. Please answer yes if the response contains every part of the correct answer. If it contains only some of the parts, answer no. Extra correct detail does not make the response wrong.\n\nQuestion: ${entry.question}\n\nCorrect Answer: ${reference}\n\nModel Response: ${hypothesis}\n\nIs the model response correct? Answer yes or no only.`;
  }
  if (entry.category === 2) {
    return `I will give you a question about when something happened, a correct answer, and a response from a model. Please answer yes if the response gives the same date as the correct answer. The benchmark asks for an approximate date, so do not penalize a different wording of the same day, and do not penalize an off-by-one error in a number of days, weeks or months.\n\nQuestion: ${entry.question}\n\nCorrect Answer: ${reference}\n\nModel Response: ${hypothesis}\n\nIs the model response correct? Answer yes or no only.`;
  }
  return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. A response that is equivalent to the correct answer is correct, and a response that wraps the correct answer in a sentence is correct. A response that contains only part of what the answer requires is not.\n\nQuestion: ${entry.question}\n\nCorrect Answer: ${reference}\n\nModel Response: ${hypothesis}\n\nIs the model response correct? Answer yes or no only.`;
}

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }).passthrough(),
  }).passthrough()).min(1),
}).passthrough();

function judgement(
  response: string,
  provider: LocomoJudgeProvider,
  model: string,
): LocomoJudgement {
  // The same label rule LongMemEval's evaluator uses, so the two benchmarks' judge
  // outputs are read the same way.
  return { correct: response.toLowerCase().includes("yes"), response, model, provider };
}

export async function judgeLocomoAnswer(
  entry: JudgedLocomoAnswer,
  hypothesis: string,
  options: {
    apiKey?: string;
    organization?: string;
    fetcher?: typeof fetch;
    pause?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<LocomoJudgement> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required by the OpenAI LoCoMo judge.");
  const fetcher = options.fetcher ?? fetch;
  const pause = options.pause ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...(options.organization ?? process.env.OPENAI_ORGANIZATION
            ? { "OpenAI-Organization": options.organization ?? process.env.OPENAI_ORGANIZATION! }
            : {}),
        },
        body: JSON.stringify({
          model: LOCOMO_OPENAI_JUDGE_MODEL,
          messages: [{ role: "user", content: locomoJudgePrompt(entry, hypothesis) }],
          n: 1,
          temperature: 0,
          max_tokens: 10,
        }),
      });
      if (!response.ok) throw new Error(`LoCoMo judge returned HTTP ${response.status}`);
      const completion = completionSchema.parse(await response.json());
      return judgement(
        completion.choices[0]!.message.content.trim(),
        "openai",
        LOCOMO_OPENAI_JUDGE_MODEL,
      );
    } catch (error) {
      lastError = error;
      if (attempt < 2) await pause(500 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LoCoMo judge failed");
}

/** The same prompt in a key-free subscription session, with no MCP and no tool actions. */
export async function judgeLocomoAnswerWithHarness(
  entry: JudgedLocomoAnswer,
  hypothesis: string,
  options: {
    provider: EvalProvider;
    runDirectory: string;
    id: string;
    runSession?: typeof runAgentSession;
    finalAnswer?: typeof agentFinalAnswer;
    toolsUsed?: typeof agentToolsUsed;
  },
): Promise<LocomoJudgement> {
  await mkdir(options.runDirectory, { recursive: true });
  const runSession = options.runSession ?? runAgentSession;
  await runSession({
    // The CLI's own default model, deliberately: a judge that moved with the model under
    // test could not compare two runs.
    harness: { provider: options.provider },
    id: options.id,
    prompt: locomoJudgePrompt(entry, hypothesis),
    runDirectory: options.runDirectory,
    knowledgeTools: false,
  });
  const used = (options.toolsUsed ?? agentToolsUsed)(
    options.runDirectory,
    options.id,
    options.provider,
  );
  if (used.length) {
    throw new Error(`LoCoMo harness judge used forbidden tool action(s): ${used.join(", ")}`);
  }
  const response = (options.finalAnswer ?? agentFinalAnswer)(
    options.runDirectory,
    options.id,
    options.provider,
  ).trim();
  if (!response) throw new Error("LoCoMo harness judge returned no answer");
  return judgement(response, options.provider, `${options.provider}-subscription`);
}
