import type { PageSnapshot } from "../snapshot.ts";
import { normalise } from "../gold/score.ts";
import type { PublicQuery, SealedAnswer } from "./questions.ts";

/**
 * Scores recorded answers against the sealed key. No model is involved.
 *
 * Every question in `world-v1` has entity names as its answer, so correctness is a set
 * comparison rather than a judgement, and the whole pass is free, instant and exactly
 * reproducible. A judge only earns its place when an answer is prose that can be right in
 * several wordings; adding one here would buy nothing and cost determinism.
 *
 * Scoring is offline, against what a run already recorded, so a run can be rescored
 * whenever the key changes — the same discipline `gold:check` follows.
 */

export type RecordedAnswer = {
  id: string;
  /** The agent's final answer, verbatim. */
  text: string;
  /** Tools the session called, so a run that bypassed the knowledge base can be voided. */
  toolsUsed: string[];
};

export type Verdict = "correct" | "partial" | "wrong" | "void";

export type QuestionScore = {
  id: string;
  text: string;
  verdict: Verdict;
  /** The question text gives its own answer away, so this one proves nothing. */
  selfAnswering: boolean;
  found: string[];
  missing: string[];
  /** People named who are in the corpus but not in the answer — a wrong attribution. */
  extra: string[];
  /**
   * For each missing name, whether the knowledge base holds it anywhere. This separates
   * "the distiller never wrote it" from "it is written but the agent did not find it",
   * which are different failures with different fixes.
   */
  missingButHeld: string[];
  /** Expected names the corpus states only in `_facts`, reported and never counted. */
  unstatedInProse: string[];
  /** Why a question was voided, when it was. */
  voidReason?: string;
};

export type RunScore = {
  scores: QuestionScore[];
  correct: number;
  partial: number;
  wrong: number;
  void: number;
  /** Correct over questions actually scored, so voided ones never flatter a run. */
  accuracy: number;
  /**
   * The headline. Accuracy over the questions that do not contain their own answer —
   * the only ones that say anything about the knowledge base.
   */
  earnedAccuracy: number;
  earnedCorrect: number;
  earnedScored: number;
};

/**
 * Reading source records would answer from the corpus instead of the knowledge base,
 * which measures the corpus rather than what was built from it.
 */
const FORBIDDEN_TOOLS = ["read_source_records"];

/** True when `name` is asserted in `text`, comparing on words alone. */
function names(text: string, name: string): boolean {
  const needle = normalise(name);
  if (!needle) return false;
  // Padded so "Mia Brown" cannot match inside a longer token run that merely contains it.
  return ` ${normalise(text)} `.includes(` ${needle} `);
}

export type ScoreInput = {
  questions: PublicQuery[];
  answers: SealedAnswer[];
  recorded: RecordedAnswer[];
  pages: PageSnapshot[];
  /** Every person the corpus can name, used to spot a confidently wrong attribution. */
  people: string[];
};

export function scoreQuestion(
  question: PublicQuery,
  answer: SealedAnswer,
  recorded: RecordedAnswer | undefined,
  pages: PageSnapshot[],
  people: string[],
): QuestionScore {
  const unstatedInProse = answer.unstated_in_prose ?? [];
  const selfAnswering = answer.self_answering ?? false;
  const base = {
    id: question.id,
    text: question.text,
    selfAnswering,
    found: [],
    missing: answer.expected_names,
    extra: [],
    missingButHeld: [],
    unstatedInProse,
  };

  if (!recorded) {
    return { ...base, verdict: "void" as const, voidReason: "no answer was recorded" };
  }
  const forbidden = recorded.toolsUsed.filter((tool) => FORBIDDEN_TOOLS.some((name) => tool.includes(name)));
  if (forbidden.length) {
    return {
      ...base,
      verdict: "void" as const,
      voidReason: `answered with ${forbidden.join(", ")}, which reads the corpus rather than the knowledge base`,
    };
  }

  const found = answer.expected_names.filter((name) => names(recorded.text, name));
  const missing = answer.expected_names.filter((name) => !found.includes(name));
  // Only people are candidates for a wrong attribution: every template asks "who", so a
  // company named as context is background, not an answer.
  const extra = people.filter((name) =>
    !answer.expected_names.includes(name) && names(recorded.text, name));

  const corpusWide = pages.map((page) => `${page.title} ${page.summary} ${page.body}`).join("\n");
  const missingButHeld = missing.filter((name) => names(corpusWide, name));

  // A name the corpus never states cannot be held against a system reading content alone.
  const countedMissing = missing.filter((name) => !unstatedInProse.includes(name));
  const verdict: Verdict = countedMissing.length === 0 && extra.length === 0
    ? "correct"
    : found.length > 0 ? "partial" : "wrong";

  return {
    id: question.id, text: question.text, selfAnswering,
    verdict, found, missing, extra, missingButHeld, unstatedInProse,
  };
}

export function scoreRun(input: ScoreInput): RunScore {
  const answers = new Map(input.answers.map((answer) => [answer.id, answer]));
  const recorded = new Map(input.recorded.map((entry) => [entry.id, entry]));

  const scores = input.questions.flatMap((question) => {
    const answer = answers.get(question.id);
    if (!answer) return [];
    return [scoreQuestion(question, answer, recorded.get(question.id), input.pages, input.people)];
  });

  const count = (verdict: Verdict) => scores.filter((score) => score.verdict === verdict).length;
  const scored = scores.length - count("void");

  const earned = scores.filter((score) => !score.selfAnswering && score.verdict !== "void");
  const earnedCorrect = earned.filter((score) => score.verdict === "correct").length;

  return {
    scores,
    correct: count("correct"),
    partial: count("partial"),
    wrong: count("wrong"),
    void: count("void"),
    accuracy: scored === 0 ? 0 : count("correct") / scored,
    earnedCorrect,
    earnedScored: earned.length,
    earnedAccuracy: earned.length === 0 ? 0 : earnedCorrect / earned.length,
  };
}
