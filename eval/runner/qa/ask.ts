import {
  agentFinalAnswer,
  agentToolsUsed,
  MCP_NAME,
  runAgentSession,
  type EvalHarness,
} from "../agent.ts";
import type { PublicQuery } from "./questions.ts";
import type { RecordedAnswer } from "./score.ts";

/**
 * Asks one question per agent session against the knowledge base a distillation run left.
 *
 * One session per question, never one session for the set: a shared session would let an
 * answer to question twelve lean on pages the agent happened to read for question three,
 * which measures the transcript rather than the knowledge base.
 *
 * The prompt carries the question and nothing else. It names no entity, no page and no
 * expected shape, because a hint is a leak — the whole point of sealing the answers is
 * that the agent has to find them.
 */

export function askPrompt(question: PublicQuery): string {
  return `Answer the following question using only the ${MCP_NAME} MCP server's knowledge base.

${question.as_of_date ? `Current date: ${question.as_of_date}\n` : ""}Question: ${question.text}

Search and read the knowledge base to find the answer. Do not inspect files, run shell
commands, or browse the web. Do not call read_source_records: you are answering from the
knowledge base, not from its sources.

Answer in one or two sentences, carrying the specific names, numbers and dates the answer
turns on and nothing else. If the knowledge base does not contain the answer, say exactly:
NOT FOUND. Do not guess, and do not pad the answer with names you cannot support — a name
you are unsure of counts against you.`;
}

export type AskOptions = {
  harness: EvalHarness;
  runDirectory: string;
  questions: PublicQuery[];
  /**
   * How the question is put, for a benchmark that specifies its own wording.
   *
   * LoCoMo asks for a short phrase and scores a token F1, so `askPrompt`'s one-or-two
   * sentences would be measured as imprecision rather than as style. The seam exists so a
   * benchmark can bring its own prompt without bringing its own session loop, which is
   * what keeps the isolation and the transcript handling identical across all of them.
   */
  prompt?: (question: PublicQuery) => string;
  onAnswer?: (answer: RecordedAnswer, index: number) => void;
};

export async function askQuestions(options: AskOptions): Promise<RecordedAnswer[]> {
  const recorded: RecordedAnswer[] = [];
  const { provider } = options.harness;
  for (const [index, question] of options.questions.entries()) {
    const id = `qa-${question.id}`;
    await runAgentSession({
      harness: options.harness,
      id,
      prompt: (options.prompt ?? askPrompt)(question),
      runDirectory: options.runDirectory,
    });
    const answer: RecordedAnswer = {
      id: question.id,
      text: agentFinalAnswer(options.runDirectory, id, provider),
      toolsUsed: agentToolsUsed(options.runDirectory, id, provider),
    };
    recorded.push(answer);
    options.onAnswer?.(answer, index);
  }
  return recorded;
}
