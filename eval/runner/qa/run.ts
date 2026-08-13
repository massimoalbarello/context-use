import { readFileSync, readdirSync } from "node:fs";
import type { PublicQuery, SealedAnswer } from "./questions.ts";

/**
 * The batches a run served, ascending.
 *
 * `report.json` is authoritative because a seed can apply many batches before writing one
 * snapshot. Snapshot filenames are a fallback for a run that stopped before its report.
 */
export function servedBatches(directory: string): string[] {
  try {
    const report = JSON.parse(readFileSync(`${directory}/report.json`, "utf8")) as {
      batches?: { batch?: string }[];
    };
    const batches = (report.batches ?? []).flatMap((entry) => entry.batch ?? []);
    if (batches.length) return [...batches].sort();
  } catch {
    // No readable report: fall back to what is on disk.
  }
  return readdirSync(directory)
    .flatMap((file) => /^batch-(.+)-snapshot\.json$/.exec(file)?.[1] ?? [])
    .sort();
}

/** Selects only questions whose evidence batches the run actually served. */
export function dueQuestions(
  directory: string,
  questions: PublicQuery[],
  answers: SealedAnswer[],
  all: boolean,
): { due: PublicQuery[]; through: string | undefined; skipped: number } {
  const served = new Set(servedBatches(directory));
  const through = [...served].sort().at(-1);
  if (all || !through) return { due: questions, through, skipped: 0 };
  const dueBy = new Map(answers.map((answer) => [answer.id, answer.due_batch]));
  const due = questions.filter((question) => served.has(dueBy.get(question.id) ?? ""));
  return { due, through, skipped: questions.length - due.length };
}
