import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, type EvalProvider } from "../agent.ts";
import { corpusIsUnchanged, diffCorpus, isCorpusId, type CorpusId } from "../corpus-integrity.ts";
import type { PageSnapshot } from "../snapshot.ts";
import { style } from "../terminal.ts";
import { askQuestions } from "./ask.ts";
import {
  answersPath,
  questionsPath,
  readAnswers,
  readQuestions,
  serialise,
  type PublicQuery,
  type SealedAnswer,
} from "./questions.ts";
import { scoreRun, type RecordedAnswer } from "./score.ts";
import { amaraPeopleNames, verifyAmaraAnswers } from "./amara-evidence.ts";
import { deriveWorldQuestions, worldPeopleNames } from "./world-derive.ts";

const RESULTS_ROOT = join(ROOT, ".eval-results");

/**
 * The corpus `qa:derive` regenerates. Only `world-v1`'s questions are derived: they are
 * read off its `_facts` blocks. `amara-life-v1`'s are authored, because its raw activity
 * carries no key to read — see [README.md](README.md).
 */
const DERIVED_CORPUS = "world-v1";

/**
 * The questions and answers are committed rather than regenerated on demand, so that a
 * change in the corpus or in the derivation is a reviewable diff instead of silently
 * moving the ground under a measurement. `qa:derive` checks them; `--write` updates them.
 */
export function deriveQuestionsCommand(options: { write: boolean }): void {
  const set = deriveWorldQuestions();
  const files: [string, unknown][] = [
    [questionsPath(DERIVED_CORPUS), set.questions],
    [answersPath(DERIVED_CORPUS), set.answers],
  ];

  if (options.write) {
    for (const [path, value] of files) writeFileSync(path, serialise(value), "utf8");
    console.log(`Wrote ${files.map(([path]) => path.split("/").at(-1)).join(" and ")}\n`);
  } else {
    for (const [path, value] of files) {
      if (!existsSync(path) || readFileSync(path, "utf8") !== serialise(value)) {
        console.error(`${path.split("/").at(-1)} is stale. Re-run with --write and review the diff.`);
        process.exitCode = 1;
      }
    }
  }

  const pairs = set.answers.reduce((total, answer) => total + answer.expected_names.length, 0);
  const unstated = set.answers.flatMap((answer) => answer.unstated_in_prose ?? []).length;
  const byTag = set.questions.reduce<Record<string, number>>((counts, question) => {
    const tag = question.tags?.[1] ?? "other";
    counts[tag] = (counts[tag] ?? 0) + 1;
    return counts;
  }, {});

  console.log(`${DERIVED_CORPUS}: ${set.questions.length} questions over ${pairs} expected answers`);
  for (const [tag, count] of Object.entries(byTag)) console.log(`  ${tag.padEnd(12)} ${count}`);
  console.log(`\nknowable from prose alone: ${pairs - unstated}/${pairs}`);
  if (unstated) {
    console.log(style.dim(`${unstated} answer(s) are stated only in _facts and are reported, never counted:`));
    for (const answer of set.answers.filter((entry) => entry.unstated_in_prose)) {
      console.log(style.dim(`  ${answer.id} ${answer.seed} -> ${answer.unstated_in_prose!.join(", ")}`));
    }
  }
}

/**
 * Re-checks `amara-life-v1`'s authored key against the corpus, and reports the shape of
 * the set.
 *
 * `world-v1` has `qa:derive`, which regenerates its questions and fails if the committed
 * copies have drifted. Nothing can regenerate an authored set, so this is its equivalent:
 * every claim the key makes that the corpus can settle is settled against the corpus, and
 * the rest of the review is the reader's.
 */
export function verifyQuestionsCommand(): void {
  const corpusId = "amara-life-v1";
  const questions = readQuestions(corpusId);
  const answers = readAnswers(corpusId);
  const issues = verifyAmaraAnswers(questions, answers);

  const byDay = new Map<string, number>();
  const byTier = new Map<string, number>();
  let joins = 0;
  for (const question of questions) byTier.set(question.tier, (byTier.get(question.tier) ?? 0) + 1);
  for (const answer of answers) {
    byDay.set(answer.due_batch, (byDay.get(answer.due_batch) ?? 0) + 1);
    if (new Set(answer.evidence?.map((entry) => entry.record)).size > 1) joins += 1;
  }
  const cited = new Set(answers.flatMap((answer) => answer.evidence?.map((entry) => entry.record) ?? []));

  console.log(style.heading(`\n${corpusId} · ${questions.length} authored questions\n`));
  console.log(`grounded in ${cited.size} distinct records, quoted verbatim`);
  console.log(`${joins} need more than one record; ${questions.length - joins} are settled by one\n`);
  console.log(style.bold("By tier"));
  for (const [tier, count] of [...byTier].sort()) console.log(`  ${tier.padEnd(14)} ${String(count).padStart(3)}`);
  console.log(style.bold("\nBy the batch that first answers it"));
  for (const [day, count] of [...byDay].sort()) console.log(`  ${day.padEnd(14)} ${String(count).padStart(3)}`);

  if (issues.length === 0) {
    console.log(style.green("\n\u2713 every answer is grounded in the corpus it is asked about"));
    return;
  }
  console.log(style.red(`\n\u2717 ${issues.length} problem(s)`));
  for (const issue of issues) console.log(style.red(`  ${issue.id}  ${issue.problem}`));
  process.exitCode = 1;
}

/** Scoring is offline, so a run is found the same way `gold:check` finds one. */
function runDirectory(runId?: string): string {
  if (runId && existsSync(runId)) return runId;
  const resolved = runId ?? readFileSync(join(RESULTS_ROOT, "latest-distill"), "utf8").trim();
  const directory = join(RESULTS_ROOT, resolved);
  if (!existsSync(directory)) throw new Error(`No such run: ${runId ?? directory}`);
  return directory;
}

function runCorpusId(directory: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(directory, "report.json"), "utf8")) as { corpusId?: string }).corpusId;
  } catch {
    return undefined;
  }
}

/**
 * The question set to put to a run: its own corpus's.
 *
 * Both corpora have one now, so the run decides rather than a constant. A run that
 * recorded no corpus id predates `--corpus` and can only be `world-v1`, which is what the
 * harness served before amara-life-v1 had questions.
 */
function corpusOf(directory: string): CorpusId {
  const corpusId = runCorpusId(directory) ?? "world-v1";
  if (!isCorpusId(corpusId) || !existsSync(questionsPath(corpusId))) {
    throw new Error(`Run ${directory.split("/").at(-1)} processed ${corpusId}, which has no question set.`);
  }
  return corpusId;
}

/** Every person the corpus can name, used to spot a confidently wrong attribution. */
function peopleNames(corpusId: CorpusId): string[] {
  return corpusId === "world-v1" ? worldPeopleNames() : amaraPeopleNames();
}

/** Batch snapshots a run recorded, ascending. Read from disk so a partial run still works. */
function recordedBatches(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((file) => /^batch-(.+)-snapshot\.json$/.exec(file)?.[1] ?? [])
    .sort();
}

/** The knowledge base as the final batch left it, which is what the questions are asked of. */
function finalSnapshot(directory: string): PageSnapshot[] {
  const last = recordedBatches(directory).at(-1);
  if (!last) throw new Error(`Run ${directory} holds no batch snapshots`);
  return JSON.parse(readFileSync(join(directory, `batch-${last}-snapshot.json`), "utf8")) as PageSnapshot[];
}

/**
 * The questions a run has actually served the evidence for.
 *
 * A two-batch run has seen 48 of 240 pages, so asking all 145 questions would spend most
 * of the budget on questions nothing could answer and then report the blanks as failures.
 * Restricting to what is due is the same discipline `gold/score.ts` applies with
 * `knowableFrom`, and it leaves the question set itself untouched — a full ten-batch run
 * is still upstream's 145.
 *
 * The window is a range, not a ceiling, because a run does not always start at the
 * beginning. `--window dense` serves amara-life-v1's eight busy days and never serves the
 * thirty-nine sparse note days before them, so a question due on 2 February is not due for
 * it however far past 2 February the last batch is. Comparing against the first recorded
 * batch as well as the last is what keeps those out.
 */
export function dueQuestions(
  directory: string,
  questions: PublicQuery[],
  answers: SealedAnswer[],
  all: boolean,
): { due: PublicQuery[]; through: string | undefined; skipped: number } {
  const batches = recordedBatches(directory);
  const from = batches.at(0);
  const through = batches.at(-1);
  if (all || !through || !from) return { due: questions, through, skipped: 0 };
  const dueBy = new Map(answers.map((answer) => [answer.id, answer.due_batch]));
  const due = questions.filter((question) => {
    const batch = dueBy.get(question.id) ?? "";
    return batch >= from && batch <= through;
  });
  return { due, through, skipped: questions.length - due.length };
}

const ANSWERS_FILE = "qa-answers.json";

export type AskOptions = {
  runId?: string | undefined;
  provider: EvalProvider;
  only?: string | undefined;
  limit?: number | undefined;
  /** Ask every question, including ones the run has not served the evidence for. */
  all?: boolean | undefined;
};

export async function askQuestionsCommand(options: AskOptions): Promise<void> {
  const directory = runDirectory(options.runId);
  const corpusId = corpusOf(directory);

  const difference = diffCorpus(corpusId);
  if (!corpusIsUnchanged(difference)) {
    throw new Error(`The vendored ${corpusId} corpus has been modified, so answers would not be comparable:\n${
      JSON.stringify(difference, null, 2)}`);
  }

  const { due, through, skipped } = dueQuestions(
    directory, readQuestions(corpusId), readAnswers(corpusId), options.all ?? false);
  let questions: PublicQuery[] = due;
  if (options.only) questions = questions.filter((question) => question.id === options.only);
  if (options.limit) questions = questions.slice(0, options.limit);
  if (questions.length === 0) {
    throw new Error(options.only
      ? `${options.only} is not due by ${through}. Pass --all to ask it anyway.`
      : "No questions selected");
  }

  const answerDirectory = join(directory, "qa");
  await mkdir(answerDirectory, { recursive: true });

  console.log(style.heading(`\nAsking ${questions.length} ${corpusId} question(s) · ${directory.split("/").at(-1)}`));
  if (skipped) {
    console.log(style.dim(`Run processed through ${through}, so ${skipped} question(s) whose evidence`));
    console.log(style.dim("it never served are held back. Pass --all to ask them anyway."));
  }
  console.log(style.dim("One session per question, against the knowledge base the run left.\n"));

  const recorded = await askQuestions({
    provider: options.provider,
    runDirectory: answerDirectory,
    questions,
    onAnswer: (answer, index) => {
      const first = answer.text.split("\n")[0] ?? "";
      console.log(`  ${String(index + 1).padStart(3)}/${questions.length}  ${
        style.bold(answer.id)}  ${first.slice(0, 80) || style.dim("(no answer)")}`);
    },
  });

  const path = join(directory, ANSWERS_FILE);
  // Merge, so asking a subset does not discard answers an earlier pass recorded.
  const existing: RecordedAnswer[] = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8")) as RecordedAnswer[]
    : [];
  const merged = new Map(existing.map((answer) => [answer.id, answer]));
  for (const answer of recorded) merged.set(answer.id, answer);
  writeFileSync(path, serialise([...merged.values()].sort((left, right) => left.id.localeCompare(right.id))), "utf8");

  console.log(style.green(`\n✓ Recorded ${recorded.length} answer(s) into ${ANSWERS_FILE}`));
  console.log(`Score them with ${style.blue(`bun run eval qa:score ${directory.split("/").at(-1)}`)}`);
}

export function scoreAnswersCommand(runId?: string): void {
  const directory = runDirectory(runId);
  const corpusId = corpusOf(directory);

  const path = join(directory, ANSWERS_FILE);
  if (!existsSync(path)) throw new Error(`Run ${directory} holds no ${ANSWERS_FILE}. Run \`bun run eval qa:ask\` first.`);

  const recorded = JSON.parse(readFileSync(path, "utf8")) as RecordedAnswer[];
  // Only the questions actually asked. Asking a subset is the normal cheap case, and
  // counting the rest as unanswered would bury a real result under 141 blanks.
  const asked = new Set(recorded.map((entry) => entry.id));
  const questions = readQuestions(corpusId).filter((question) => asked.has(question.id));

  const result = scoreRun({
    questions,
    answers: readAnswers(corpusId),
    recorded,
    pages: finalSnapshot(directory),
    people: peopleNames(corpusId),
  });
  const { scores } = result;

  const through = recordedBatches(directory).at(-1);
  console.log(style.heading(`\nQA score · ${corpusId} · ${directory.split("/").at(-1)}`));
  if (through) console.log(style.dim(`Knowledge base built through ${through}.`));
  for (const score of scores) {
    const mark = score.verdict === "correct" ? style.green("✓")
      : score.verdict === "void" ? style.yellow("–") : style.red("✗");
    console.log(`\n${mark} ${style.bold(score.id)}  ${score.text}`);
    if (score.verdict === "void") {
      console.log(style.yellow(`    void — ${score.voidReason}`));
      continue;
    }
    if (score.found.length) console.log(style.dim(`    found   ${score.found.join(", ")}`));
    for (const name of score.missing) {
      const held = score.missingButHeld.includes(name);
      const unstated = score.unstatedInProse.includes(name);
      console.log(style.red(`    missing ${name}`) + style.dim(
        unstated ? " — stated only in _facts, not counted"
          : held ? " — held in the knowledge base but not found"
            : " — never written to the knowledge base"));
    }
    if (score.extra.length) console.log(style.red(`    named who should not be: ${score.extra.join(", ")}`));
  }

  const scored = scores.length - scores.filter((score) => score.verdict === "void").length;
  const selfAnswering = scores.filter((score) => score.selfAnswering && score.verdict !== "void").length;
  console.log(style.bold("\nAcross the run"));
  console.log(`  correct   ${result.correct}/${scored}`);
  console.log(`  partial   ${result.partial}`);
  console.log(`  wrong     ${result.wrong}`);
  if (result.void) console.log(style.yellow(`  void      ${result.void}  — not counted`));
  console.log(`  accuracy  ${Math.round(result.accuracy * 100)}%  ${style.dim("(all questions)")}`);
  console.log(style.bold(`  earned    ${Math.round(result.earnedAccuracy * 100)}%  `)
    + `${result.earnedCorrect}/${result.earnedScored}`);
  if (selfAnswering) {
    console.log(style.dim(`\n  ${selfAnswering} question(s) name their own answer — upstream titles its one-on-ones`));
    console.log(style.dim("  \"1:1 Wendy Hernandez + Mia Brown\" and then asks who attended. Echoing the"));
    console.log(style.dim("  question scores those with an empty knowledge base, so `earned` is the headline."));
  }

  // A voided question tells us nothing about the knowledge base, so its names are not
  // evidence of a gap in it either.
  const counted = scores.filter((score) => score.verdict !== "void");
  const neverWritten = counted.flatMap((score) =>
    score.missing.filter((name) => !score.missingButHeld.includes(name))).length;
  const notFound = counted.flatMap((score) => score.missingButHeld).length;
  if (neverWritten || notFound) {
    console.log(style.dim(`\n  ${neverWritten} expected name(s) never reached the knowledge base; ${
      notFound} are held but were not found. The first is a distillation gap, the second a retrieval one.`));
  }
}
