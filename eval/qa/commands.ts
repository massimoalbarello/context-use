import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, type EvalProvider } from "../agent.ts";
import { corpusIsUnchanged, diffCorpus } from "../corpus-integrity.ts";
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
} from "./questions.ts";
import { scoreRun, type RecordedAnswer } from "./score.ts";
import { deriveWorldQuestions, worldPeopleNames } from "./world-derive.ts";

const RESULTS_ROOT = join(ROOT, ".eval-results");

/**
 * `world-v1` is the only corpus with a question set so far. `amara-life-v1`'s has to be
 * authored rather than derived, because its raw activity carries no `_facts` to read a
 * key off — see [README.md](README.md).
 */
const QA_CORPUS = "world-v1";

/**
 * The questions and answers are committed rather than regenerated on demand, so that a
 * change in the corpus or in the derivation is a reviewable diff instead of silently
 * moving the ground under a measurement. `qa:derive` checks them; `--write` updates them.
 */
export function deriveQuestionsCommand(options: { write: boolean }): void {
  const set = deriveWorldQuestions();
  const files: [string, unknown][] = [
    [questionsPath(QA_CORPUS), set.questions],
    [answersPath(QA_CORPUS), set.answers],
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

  console.log(`${QA_CORPUS}: ${set.questions.length} questions over ${pairs} expected answers`);
  for (const [tag, count] of Object.entries(byTag)) console.log(`  ${tag.padEnd(12)} ${count}`);
  console.log(`\nknowable from prose alone: ${pairs - unstated}/${pairs}`);
  if (unstated) {
    console.log(style.dim(`${unstated} answer(s) are stated only in _facts and are reported, never counted:`));
    for (const answer of set.answers.filter((entry) => entry.unstated_in_prose)) {
      console.log(style.dim(`  ${answer.id} ${answer.seed} -> ${answer.unstated_in_prose!.join(", ")}`));
    }
  }
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

function assertRunMatches(directory: string): void {
  const corpusId = runCorpusId(directory);
  if (corpusId && corpusId !== QA_CORPUS) {
    throw new Error(`Run ${directory.split("/").at(-1)} processed ${corpusId}, and the question set is ${QA_CORPUS}'s. `
      + "Use `bun run eval gold:check` for amara-life-v1.");
  }
}

/** The knowledge base as the final batch left it, which is what the questions are asked of. */
function finalSnapshot(directory: string): PageSnapshot[] {
  const snapshots = readdirSync(directory).filter((file) => /^batch-.+-snapshot\.json$/.test(file)).sort();
  const last = snapshots.at(-1);
  if (!last) throw new Error(`Run ${directory} holds no batch snapshots`);
  return JSON.parse(readFileSync(join(directory, last), "utf8")) as PageSnapshot[];
}

const ANSWERS_FILE = "qa-answers.json";

export type AskOptions = {
  runId?: string | undefined;
  provider: EvalProvider;
  only?: string | undefined;
  limit?: number | undefined;
};

export async function askQuestionsCommand(options: AskOptions): Promise<void> {
  const difference = diffCorpus(QA_CORPUS);
  if (!corpusIsUnchanged(difference)) {
    throw new Error(`The vendored ${QA_CORPUS} corpus has been modified, so answers would not be comparable:\n${
      JSON.stringify(difference, null, 2)}`);
  }

  const directory = runDirectory(options.runId);
  assertRunMatches(directory);

  let questions: PublicQuery[] = readQuestions(QA_CORPUS);
  if (options.only) questions = questions.filter((question) => question.id === options.only);
  if (options.limit) questions = questions.slice(0, options.limit);
  if (questions.length === 0) throw new Error("No questions selected");

  const answerDirectory = join(directory, "qa");
  await mkdir(answerDirectory, { recursive: true });

  console.log(style.heading(`\nAsking ${questions.length} question(s) · ${directory.split("/").at(-1)}`));
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
  assertRunMatches(directory);

  const path = join(directory, ANSWERS_FILE);
  if (!existsSync(path)) throw new Error(`Run ${directory} holds no ${ANSWERS_FILE}. Run \`bun run eval qa:ask\` first.`);

  const recorded = JSON.parse(readFileSync(path, "utf8")) as RecordedAnswer[];
  // Only the questions actually asked. Asking a subset is the normal cheap case, and
  // counting the rest as unanswered would bury a real result under 141 blanks.
  const asked = new Set(recorded.map((entry) => entry.id));
  const questions = readQuestions(QA_CORPUS).filter((question) => asked.has(question.id));

  const result = scoreRun({
    questions,
    answers: readAnswers(QA_CORPUS),
    recorded,
    pages: finalSnapshot(directory),
    people: worldPeopleNames(),
  });
  const { scores } = result;

  console.log(style.heading(`\nQA score · ${QA_CORPUS} · ${directory.split("/").at(-1)}`));
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
