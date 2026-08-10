import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_NAME, runAgentSession, type EvalProvider } from "../agent.ts";
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

Question: ${question.text}

Search and read the knowledge base to find the answer. Do not inspect files, run shell
commands, or browse the web. Do not call read_source_records: you are answering from the
knowledge base, not from its sources.

Answer with the names, and nothing else. If the knowledge base does not contain the
answer, say exactly: NOT FOUND. Do not guess, and do not pad the answer with names you
cannot support — a name you are unsure of counts against you.`;
}

/** Every tool a session called, read back from the provider's own transcript. */
function toolsUsed(runDirectory: string, id: string, provider: EvalProvider): string[] {
  const path = join(runDirectory, `${id}-${provider}.jsonl`);
  const tools = new Set<string>();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    // Both providers name tools in their event stream; the shapes differ, the names do
    // not. Scanning for the name is enough to prove a forbidden tool was reached for.
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      for (const match of JSON.stringify(event).matchAll(/"(?:tool|name)":\s*"([a-z_]+)"/g)) {
        tools.add(match[1]!);
      }
    } catch {
      continue;
    }
  }
  return [...tools].sort();
}

/**
 * The final message a session produced, which is the answer being scored.
 *
 * Codex is asked for it directly with `--output-last-message`. Claude Code has no such
 * flag, so its answer is read back out of the `stream-json` transcript, where the final
 * turn arrives as a `result` event.
 */
function finalAnswer(runDirectory: string, id: string, provider: EvalProvider): string {
  if (provider === "codex") {
    try {
      return readFileSync(join(runDirectory, `${id}-final.md`), "utf8").trim();
    } catch {
      return "";
    }
  }
  let raw: string;
  try {
    raw = readFileSync(join(runDirectory, `${id}-claude.jsonl`), "utf8");
  } catch {
    return "";
  }
  let answer = "";
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { type?: string; result?: unknown; is_error?: boolean };
      if (event.type === "result" && !event.is_error && typeof event.result === "string") {
        answer = event.result;
      }
    } catch {
      continue;
    }
  }
  return answer.trim();
}

export type AskOptions = {
  provider: EvalProvider;
  runDirectory: string;
  questions: PublicQuery[];
  onAnswer?: (answer: RecordedAnswer, index: number) => void;
};

export async function askQuestions(options: AskOptions): Promise<RecordedAnswer[]> {
  const recorded: RecordedAnswer[] = [];
  for (const [index, question] of options.questions.entries()) {
    const id = `qa-${question.id}`;
    await runAgentSession({
      provider: options.provider,
      id,
      prompt: askPrompt(question),
      runDirectory: options.runDirectory,
    });
    const answer: RecordedAnswer = {
      id: question.id,
      text: finalAnswer(options.runDirectory, id, options.provider),
      toolsUsed: toolsUsed(options.runDirectory, id, options.provider),
    };
    recorded.push(answer);
    options.onAnswer?.(answer, index);
  }
  return recorded;
}
