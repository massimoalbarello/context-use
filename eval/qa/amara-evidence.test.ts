import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAmaraCorpus } from "../corpus-amara.ts";
import { datedRecords } from "../corpus-types.ts";
import { corpusDirectory } from "../corpus-integrity.ts";
import { amaraPeopleNames, verifyAmaraAnswers } from "./amara-evidence.ts";
import { dueQuestions } from "./commands.ts";
import { goldFieldsIn, readAnswers, readQuestions, type SealedAnswer } from "./questions.ts";
import { scoreQuestion } from "./score.ts";

/**
 * The authored question set's own guarantee.
 *
 * Everything here re-derives a claim the key makes from the corpus it is about, so a key
 * that drifts — because it was edited, or because the corpus was re-pinned — fails the
 * build rather than quietly mis-scoring every system measured against it.
 */

const questions = readQuestions("amara-life-v1");
const answers = readAnswers("amara-life-v1");
const byId = new Map(answers.map((answer) => [answer.id, answer]));

describe("the amara-life-v1 question set", () => {
  test("is grounded, verbatim, in the pinned corpus", () => {
    expect(verifyAmaraAnswers(questions, answers)).toEqual([]);
  });

  test("gives every question exactly one sealed answer, in order", () => {
    expect(answers).toHaveLength(questions.length);
    expect(questions.map((question) => question.id))
      .toEqual(questions.map((_, index) => `q-${String(index + 1).padStart(4, "0")}`));
    expect(answers.map((answer) => answer.id)).toEqual(questions.map((question) => question.id));
  });

  test("leaks no answer into the file the agent is shown", () => {
    for (const question of questions) expect(goldFieldsIn(question)).toEqual([]);
    // The sealed side is where the answer lives, and the public side must not carry it.
    const published = JSON.stringify(questions);
    for (const answer of answers) expect(published).not.toContain(answer.answer);
  });

  test("asks enough, over enough of the corpus, to mean something", () => {
    expect(questions.length).toBeGreaterThanOrEqual(80);
    const cited = new Set(answers.flatMap((answer) => answer.evidence!.map((entry) => entry.record)));
    expect(cited.size).toBeGreaterThanOrEqual(60);
    // Spread over the corpus's own days rather than mined out of the richest one.
    expect(new Set(answers.map((answer) => answer.due_batch)).size).toBeGreaterThanOrEqual(10);
    // A set of single-record lookups measures retrieval, not a knowledge base.
    const joins = answers.filter((answer) =>
      new Set(answer.evidence!.map((entry) => entry.record)).size > 1);
    expect(joins.length).toBeGreaterThanOrEqual(10);
  });

  test("reaches every source type the corpus serves", () => {
    const records = new Map(loadAmaraCorpus(corpusDirectory("amara-life-v1")).records
      .map((record) => [record.slug, record.type] as const));
    const types = new Set(answers.flatMap((answer) =>
      answer.evidence!.map((entry) => records.get(entry.record))));
    expect([...types].sort()).toEqual(["calendar-event", "email", "meeting", "note", "slack"]);
  });

  test("dates every question by the last evidence its own answer needs", () => {
    const records = new Map(datedRecords(loadAmaraCorpus(corpusDirectory("amara-life-v1")))
      .map((record) => [record.slug, record.day] as const));
    for (const answer of answers) {
      const last = answer.evidence!.map((entry) => records.get(entry.record)!).sort().at(-1);
      expect({ id: answer.id, due: answer.due_batch }).toEqual({ id: answer.id, due: last! });
    }
  });
});

describe("grading the authored set", () => {
  const score = (id: string, text: string) =>
    scoreQuestion(questions.find((question) => question.id === id)!, byId.get(id)!,
      { id, text, toolsUsed: ["search_pages"] }, [], amaraPeopleNames());

  const idOf = (fragment: string): string =>
    answers.find((answer) => answer.answer?.includes(fragment))!.id;

  test("passes each reference answer against its own key", () => {
    for (const answer of answers) {
      const result = score(answer.id, answer.answer!);
      expect({ id: answer.id, missing: result.missing, extra: result.extra })
        .toEqual({ id: answer.id, missing: [], extra: [] });
    }
  });

  test("accepts a number written the other way round", () => {
    // The corpus writes "$2.1M"; a knowledge base may well write "$2.1 million".
    const id = idOf("$2.1M ARR");
    expect(score(id, "Capacitor Labs reached $2.1 million in ARR, up 34% on Q4.").verdict).toBe("correct");
  });

  test("rejects a different number", () => {
    const id = idOf("$2.1M ARR");
    expect(score(id, "Capacitor Labs reached $2.4M ARR, up 34% on Q4.").verdict).toBe("partial");
  });

  test("rejects the confusable entity", () => {
    // Meridian Health, Labs, Robotics and Ventures are four companies in this corpus.
    const id = idOf("Meridian Health");
    expect(score(id, "Meridian Robotics.").verdict).toBe("wrong");
  });

  test("counts a fuller form of a first-name answer as right, not as a second person", () => {
    // The corpus names her only as "Daria"; the gold standard knows her as Daria Novak.
    const id = idOf("Daria");
    expect(score(id, "Daria Novak raised them during her legal review.").verdict).toBe("correct");
  });

  test("does not treat a person named as context as a wrong attribution", () => {
    // The answer is a number, so whoever reported it is background, not a competing claim.
    const id = idOf("$4.2M");
    const result = score(id, "Hannah Liu reported that ARR had just crossed $4.2M.");
    expect({ verdict: result.verdict, extra: result.extra }).toEqual({ verdict: "correct", extra: [] });
  });

  test("still catches a wrong attribution when the answer is a person", () => {
    const id = idOf("Anna Petrov");
    const result = score(id, "Bill Hart covered it.");
    expect(result.verdict).toBe("wrong");
    expect(result.extra).toContain("Bill Hart");
  });

  test("voids an answer that read the corpus instead of the knowledge base", () => {
    const answer = answers[0]!;
    const question = questions[0]!;
    const result = scoreQuestion(question, answer,
      { id: answer.id, text: answer.answer!, toolsUsed: ["read_source_records"] }, [], amaraPeopleNames());
    expect(result.verdict).toBe("void");
  });
});

describe("which questions a run is asked", () => {
  const run = (batches: string[]): string => {
    const directory = mkdtempSync(join(tmpdir(), "qa-due-"));
    for (const batch of batches) writeFileSync(join(directory, `batch-${batch}-snapshot.json`), "[]");
    return directory;
  };

  test("holds back questions whose evidence the run has not reached yet", () => {
    const { due, skipped } = dueQuestions(run(["2026-04-13"]), questions, answers, false);
    expect(due.length).toBe(11);
    expect(skipped).toBe(questions.length - 11);
  });

  test("holds back questions from days a dense run never serves", () => {
    // The dense window starts on 13 April and never serves the thirty-nine sparse note
    // days before it, so a question due on 2 February is not due for this run however far
    // past 2 February its last batch is. Treating the window as a ceiling asked fourteen
    // questions about notes the agent was never handed.
    const dense = dueQuestions(run(["2026-04-13", "2026-04-14"]), questions, answers, false);
    expect(dense.due.length).toBe(25);
    const dueIds = new Set(dense.due.map((question) => question.id));
    const sparse = answers.filter((answer) => answer.due_batch < "2026-04-13");
    expect(sparse.length).toBeGreaterThan(0);
    for (const answer of sparse) expect(dueIds.has(answer.id)).toBe(false);
  });

  test("asks a sparse day once the run has served that day", () => {
    // Membership, not a range: serving 2 February and 14 April does not imply serving the
    // seventy days between them, so only questions due on those two days are asked.
    const { due } = dueQuestions(run(["2026-02-02", "2026-04-14"]), questions, answers, false);
    const dueBatches = new Set(due.map((question) =>
      answers.find((answer) => answer.id === question.id)!.due_batch));
    expect([...dueBatches].sort()).toEqual(["2026-02-02", "2026-04-14"]);
  });

  test("reads the served batches from the run's report, not its snapshot files", () => {
    // A seed applies every batch at once and snapshots only the result, so counting
    // snapshot files would say a ten-batch seed served one batch and hold back every
    // question but the last batch's.
    const directory = run(["2026-04-14"]);
    writeFileSync(join(directory, "report.json"), JSON.stringify({
      corpusId: "amara-life-v1",
      mode: "seed",
      batches: [{ batch: "2026-04-13" }, { batch: "2026-04-14" }],
    }));
    expect(dueQuestions(directory, questions, answers, false).due.length).toBe(25);
  });

  test("--all overrides the window", () => {
    expect(dueQuestions(run(["2026-04-13"]), questions, answers, true).due).toHaveLength(questions.length);
  });
});

describe("amaraPeopleNames", () => {
  test("is the gold standard's cast, including the ones only context identifies", () => {
    const people = amaraPeopleNames();
    expect(people.length).toBeGreaterThanOrEqual(20);
    for (const name of ["Priya Sharma", "Priya Patel", "Marcus Reid", "Marcus Chen", "Daria Novak"]) {
      expect(people).toContain(name);
    }
  });
});

describe("world-v1 is untouched by the widened key", () => {
  test("keeps plain-string expected names, and scores them as before", () => {
    const worldAnswers: SealedAnswer[] = readAnswers("world-v1");
    expect(worldAnswers.every((answer) => answer.expected_names.every((name) => typeof name === "string")))
      .toBe(true);
    const worldQuestions = readQuestions("world-v1");
    const answer = worldAnswers[0]!;
    const question = worldQuestions.find((entry) => entry.id === answer.id)!;
    const text = (answer.expected_names as string[]).join(" and ");
    expect(scoreQuestion(question, answer, { id: answer.id, text, toolsUsed: [] }, [], []).verdict)
      .toBe("correct");
  });
});
