import { createHash } from "node:crypto";
import type { LocomoQuestion } from "../../data/locomo-v1/dataset.ts";
import { MCP_NAME } from "../agent.ts";

/**
 * How LoCoMo poses a question, reproduced so the answers are scorable by its own rubric.
 *
 * The repository's ordinary QA prompt asks for one or two sentences. LoCoMo's asks for a
 * short phrase in the conversation's own words, and its scorer is a token F1 — a fluent
 * sentence around a correct answer loses most of its precision. Asking the benchmark's way
 * is therefore part of running the benchmark, not a stylistic preference, and it is also
 * what A-mem's harness does.
 *
 * Three of the five categories are asked plainly. Category 2 carries upstream's date
 * instruction, and category 5 is a forced choice between the real answer and "Not mentioned
 * in the conversation".
 */

export const NOT_MENTIONED = "Not mentioned in the conversation";

export type AskedLocomoQuestion = {
  question: LocomoQuestion;
  /** The question exactly as it is put to the agent, per-category suffix included. */
  text: string;
  /** Category 5 only: the two options, in the order the agent saw them. */
  options?: { a: string; b: string };
};

/**
 * Which option goes first in a category 5 question.
 *
 * Both upstreams call `random.random()` here, so two runs of the same benchmark put the
 * same question differently and neither can be reproduced. The order is decided by the
 * question id instead: still evenly split across the set, still not guessable from the
 * question, and identical every run. This is a deliberate departure and the report records
 * it.
 */
function realAnswerFirst(questionId: string): boolean {
  return createHash("sha256").update(questionId).digest()[0]! % 2 === 0;
}

export function askedLocomoQuestion(question: LocomoQuestion): AskedLocomoQuestion {
  if (question.category === 2) {
    return {
      question,
      text: `${question.question} Use DATE of CONVERSATION to answer with an approximate date.`,
    };
  }
  if (question.category === 5) {
    const options = realAnswerFirst(question.id)
      ? { a: question.referenceAnswer, b: NOT_MENTIONED }
      : { a: NOT_MENTIONED, b: question.referenceAnswer };
    return {
      question,
      text: `${question.question} Select the correct answer: (a) ${options.a} (b) ${options.b}. `,
      options,
    };
  }
  return { question, text: question.question };
}

/**
 * The read-only constraints are this repository's; the answer-shape instruction is
 * LoCoMo's. `as_of` is not upstream's: LoCoMo hands a model the whole dated transcript and
 * lets it infer "now" from the last session, which an agent reading a distilled knowledge
 * base cannot do. Supplying that same last session date states the assumption instead of
 * leaving the temporal questions unanswerable by construction.
 */
export function locomoAskPrompt(asked: AskedLocomoQuestion, asOfDate: string): string {
  const shape = asked.question.category === 5
    ? "Reply with the option you choose and nothing else."
    : "Write an answer in the form of a short phrase. Answer with exact words from the "
      + "knowledge base whenever possible, and do not write a sentence around it.";
  return `Answer the following question using only the ${MCP_NAME} MCP server's knowledge base.

Current date: ${asOfDate}

Search and read the knowledge base to find the answer. Do not inspect files, run shell
commands, or browse the web. Do not call read_source_records: you are answering from the
knowledge base, not from its sources.

${shape}

Question: ${asked.text} Short answer:`;
}

/**
 * Upstream's `get_cat_5_answer`: a bare letter is expanded back into the option it names,
 * and anything else is taken at face value. Without it a reply of "b" scores zero however
 * right it was.
 */
export function resolveLocomoAnswer(asked: AskedLocomoQuestion, answer: string): string {
  if (!asked.options) return answer.trim();
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "a" || trimmed === "(a)" || trimmed === "a." || trimmed === "a)") {
    return asked.options.a;
  }
  if (trimmed === "b" || trimmed === "(b)" || trimmed === "b." || trimmed === "b)") {
    return asked.options.b;
  }
  return answer.trim();
}

export const locomoAskInternals = { realAnswerFirst };
