import { describe, expect, test } from "bun:test";
import { askPrompt } from "../../../runner/qa/ask.ts";
import {
  forms,
  goldFieldsIn,
  readAnswers,
  readQuestions,
  serialise,
} from "../../../runner/qa/questions.ts";
import { deriveWorldQuestions, worldPeopleNames } from "./derive.ts";

const CORPUS = "world-v1";

describe("world-v1 question set", () => {
  test("the committed copies match the derivation", () => {
    const set = deriveWorldQuestions();
    // Committed so that a change in the corpus or the derivation is a reviewable diff
    // rather than a silent shift under a measurement.
    expect(serialise(readQuestions(CORPUS))).toBe(serialise(set.questions));
    expect(serialise(readAnswers(CORPUS))).toBe(serialise(set.answers));
  });

  test("reproduces upstream's 145 questions across its four templates", () => {
    const questions = readQuestions(CORPUS);
    expect(questions).toHaveLength(145);
    const byTag = questions.reduce<Record<string, number>>((counts, question) => {
      const tag = question.tags?.[1] ?? "other";
      counts[tag] = (counts[tag] ?? 0) + 1;
      return counts;
    }, {});
    expect(byTag).toEqual({ attended: 50, "works-at": 40, "invested-in": 39, advises: 16 });
    expect(readAnswers(CORPUS).reduce((total, answer) => total + answer.expected_names.length, 0))
      .toBe(261);
  });

  test("is sealed: the public file carries no answer", () => {
    const questions = readQuestions(CORPUS);
    for (const question of questions) {
      // Upstream's `public-probe.schema.json` pattern, so their tooling can read this file.
      expect(question.id).toMatch(/^q-[0-9]{4}$/);
      expect(goldFieldsIn(question)).toEqual([]);
    }
    // The strongest form: no expected name appears anywhere in the questions file —
    // except where upstream's own question wording gives it away, which is flagged on
    // the sealed side and reported separately rather than silently scored.
    const answers = new Map(readAnswers(CORPUS).map((answer) => [answer.id, answer]));
    const asText = serialise(questions.filter((question) => !answers.get(question.id)!.self_answering));
    for (const answer of answers.values()) {
      if (answer.self_answering) continue;
      for (const name of answer.expected_names) expect(asText).not.toContain(name);
    }
  });

  test("flags exactly the questions that give away their own answer", () => {
    const questions = new Map(readQuestions(CORPUS).map((question) => [question.id, question]));
    const answers = readAnswers(CORPUS);
    // 25 one-on-ones titled "1:1 A + B", asked as "Who attended 1:1 A + B?".
    expect(answers.filter((answer) => answer.self_answering)).toHaveLength(25);
    for (const answer of answers) {
      const text = questions.get(answer.id)!.text;
      const givesItself = answer.expected_names.some((name) => forms(name).some((form) => text.includes(form)));
      expect(answer.self_answering ?? false).toBe(givesItself);
    }
  });

  test("pairs every question with exactly one answer", () => {
    const questions = readQuestions(CORPUS);
    const answers = readAnswers(CORPUS);
    expect(answers.map((answer) => answer.id)).toEqual(questions.map((question) => question.id));
    for (const answer of answers) {
      expect(answer.expected_names.length).toBe(answer.relevant.length);
      expect(answer.expected_names.length).toBeGreaterThan(0);
    }
  });

  test("the prompt handed to the agent leaks no answer", () => {
    const questions = readQuestions(CORPUS);
    const answers = new Map(readAnswers(CORPUS).map((answer) => [answer.id, answer]));
    for (const question of questions) {
      const answer = answers.get(question.id)!;
      const prompt = askPrompt(question);
      // The prompt is the question and nothing else, so where upstream's own wording
      // names the answer the prompt does too. Those are flagged and reported separately.
      if (!answer.self_answering) {
        for (const name of answer.expected_names) expect(prompt).not.toContain(name);
      }
      // Never a slug, though: that would let an agent fetch the page directly.
      for (const slug of answer.relevant) expect(prompt).not.toContain(slug);
    }
  });

  test("every answer is recoverable from prose alone", () => {
    // Matching on slugs rather than page titles is what makes this true: prose writes
    // "[Beta](companies/beta-1)" and never the title "Beta - Cybersecurity Startup".
    const answers = readAnswers(CORPUS);
    expect(answers.flatMap((answer) => answer.unstated_in_prose ?? [])).toEqual([]);
  });

  test("marks each question with the batch that makes it answerable", () => {
    const answers = readAnswers(CORPUS);
    const batches = new Set(answers.map((answer) => answer.due_batch));
    // Ten batches, and every one of them brings new questions into play.
    expect([...batches].sort()).toEqual(
      Array.from({ length: 10 }, (_, index) => `batch-${String(index + 1).padStart(2, "0")}`));
    // A short run is scored against what it was served, so the counts have to grow.
    let previous = 0;
    for (const batch of [...batches].sort()) {
      const due = answers.filter((answer) => answer.due_batch <= batch).length;
      expect(due).toBeGreaterThan(previous);
      previous = due;
    }
    expect(previous).toBe(145);
  });

  test("names every person the corpus can attribute an answer to", () => {
    const people = worldPeopleNames();
    expect(people).toHaveLength(80);
    expect(people).toEqual([...people].sort());
  });
});
