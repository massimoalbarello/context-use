import { z } from "zod";
import type { LongMemEvalCase } from "../../data/longmemeval-v1/dataset.ts";

/** The model pinned by LongMemEval's published `evaluate_qa.py`. */
export const LONGMEMEVAL_JUDGE_MODEL = "gpt-4o-2024-08-06";

function answerText(answer: unknown): string {
  if (typeof answer === "string") return answer;
  const serialized = JSON.stringify(answer);
  if (serialized === undefined) throw new Error("LongMemEval reference answer cannot be undefined");
  return serialized;
}

export function longMemEvalJudgePrompt(
  entry: Pick<LongMemEvalCase, "questionType" | "question" | "referenceAnswer" | "abstention">,
  hypothesis: string,
): string {
  const answer = answerText(entry.referenceAnswer);
  if (entry.abstention) {
    return `I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: ${entry.question}\n\nExplanation: ${answer}\n\nModel Response: ${hypothesis}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only.`;
  }
  if (["single-session-user", "single-session-assistant", "multi-session"].includes(entry.questionType)) {
    return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. \n\nQuestion: ${entry.question}\n\nCorrect Answer: ${answer}\n\nModel Response: ${hypothesis}\n\nIs the model response correct? Answer yes or no only.`;
  }
  if (entry.questionType === "temporal-reasoning") {
    return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. \n\nQuestion: ${entry.question}\n\nCorrect Answer: ${answer}\n\nModel Response: ${hypothesis}\n\nIs the model response correct? Answer yes or no only.`;
  }
  if (entry.questionType === "knowledge-update") {
    return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.\n\nQuestion: ${entry.question}\n\nCorrect Answer: ${answer}\n\nModel Response: ${hypothesis}\n\nIs the model response correct? Answer yes or no only.`;
  }
  return `I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.\n\nQuestion: ${entry.question}\n\nRubric: ${answer}\n\nModel Response: ${hypothesis}\n\nIs the model response correct? Answer yes or no only.`;
}

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }).passthrough(),
  }).passthrough()).min(1),
}).passthrough();

export type LongMemEvalJudgement = {
  correct: boolean;
  response: string;
  model: string;
};

export async function judgeLongMemEvalAnswer(
  entry: Pick<LongMemEvalCase, "questionType" | "question" | "referenceAnswer" | "abstention">,
  hypothesis: string,
  options: {
    apiKey?: string;
    organization?: string;
    fetcher?: typeof fetch;
    pause?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<LongMemEvalJudgement> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required by the official LongMemEval QA judge.");
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
          model: LONGMEMEVAL_JUDGE_MODEL,
          messages: [{ role: "user", content: longMemEvalJudgePrompt(entry, hypothesis) }],
          n: 1,
          temperature: 0,
          max_tokens: 10,
        }),
      });
      if (!response.ok) {
        const message = `LongMemEval judge returned HTTP ${response.status}`;
        if (response.status !== 429 && response.status < 500) throw new Error(message);
        throw new Error(message);
      }
      const completion = completionSchema.parse(await response.json());
      const judgeResponse = completion.choices[0]!.message.content.trim();
      return {
        correct: judgeResponse.toLowerCase().includes("yes"),
        response: judgeResponse,
        model: LONGMEMEVAL_JUDGE_MODEL,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await pause(500 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LongMemEval judge failed");
}
