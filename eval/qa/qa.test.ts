import { describe, expect, test } from "bun:test";
import type { PageSnapshot } from "../snapshot.ts";
import { askPrompt } from "./ask.ts";
import {
  forms,
  goldFieldsIn,
  readAnswers,
  readQuestions,
  serialise,
  type PublicQuery,
  type SealedAnswer,
} from "./questions.ts";
import { scoreQuestion, scoreRun, type RecordedAnswer } from "./score.ts";
import { deriveWorldQuestions, worldPeopleNames } from "./world-derive.ts";

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

const QUESTION: PublicQuery = {
  id: "q-0001",
  tier: "medium",
  text: "Who attended Acme Board Meeting Q1 2025?",
  expected_output_type: "answer-string",
  tags: ["relational", "attended"],
};

const ANSWER: SealedAnswer = {
  id: "q-0001",
  relevant: ["people/mia-brown-0", "people/chris-jackson-91"],
  expected_names: ["Mia Brown", "Chris Jackson"],
  seed: "meetings/board-acme-2025-q1-0",
  link_types: ["attended"],
  due_batch: "batch-01",
};

const PEOPLE = ["Mia Brown", "Chris Jackson", "Ian Anderson"];

function page(body: string): PageSnapshot {
  return { id: "1", path: "meetings/acme-q1", version: 1, title: "Acme Board Q1", summary: "", body };
}

function recorded(text: string, toolsUsed: string[] = ["search_pages", "get_page"]): RecordedAnswer {
  return { id: "q-0001", text, toolsUsed };
}

describe("scoring recorded answers", () => {
  test("counts every expected name, in any wording", () => {
    const score = scoreQuestion(QUESTION, ANSWER,
      recorded("Mia Brown and Chris Jackson attended."), [], PEOPLE);
    expect(score.verdict).toBe("correct");
    expect(score.found).toEqual(["Mia Brown", "Chris Jackson"]);
    expect(score.missing).toEqual([]);
  });

  test("reads names through markdown links", () => {
    const score = scoreQuestion(QUESTION, ANSWER,
      recorded("[Mia Brown](people/mia-brown-0), [Chris Jackson](people/chris-jackson-91)"), [], PEOPLE);
    expect(score.verdict).toBe("correct");
  });

  test("fails an answer that names someone who was not there", () => {
    // Naming a non-attendee is a wrong answer, not a partially right one.
    const score = scoreQuestion(QUESTION, ANSWER,
      recorded("Mia Brown, Chris Jackson and Ian Anderson."), [], PEOPLE);
    expect(score.verdict).toBe("partial");
    expect(score.extra).toEqual(["Ian Anderson"]);
  });

  test("separates a distillation gap from a retrieval one", () => {
    const held = [page("Chris Jackson chaired Acme Board Meeting Q1 2025.")];
    const score = scoreQuestion(QUESTION, ANSWER, recorded("Mia Brown."), held, PEOPLE);
    expect(score.verdict).toBe("partial");
    expect(score.missing).toEqual(["Chris Jackson"]);
    // Written to the knowledge base, so this is the agent failing to find it.
    expect(score.missingButHeld).toEqual(["Chris Jackson"]);

    const empty = scoreQuestion(QUESTION, ANSWER, recorded("Mia Brown."), [], PEOPLE);
    expect(empty.missingButHeld).toEqual([]);
  });

  test("does not call a name held when the page carrying it is about something else", () => {
    // The weaker test — the string appears somewhere — turns a distillation gap into a
    // retrieval one in the report. On amara it counted an unrelated page's "40%" and a
    // different company's "DeepMind" as the answer being present.
    const elsewhere = [page("Chris Jackson spoke at the Beta offsite.")];
    const score = scoreQuestion(QUESTION, ANSWER, recorded("Mia Brown."), elsewhere, PEOPLE);
    expect(score.missing).toEqual(["Chris Jackson"]);
    expect(score.missingButHeld).toEqual([]);
  });

  test("voids an answer that read the corpus instead of the knowledge base", () => {
    const score = scoreQuestion(QUESTION, ANSWER,
      recorded("Mia Brown and Chris Jackson.", ["read_source_records"]), [], PEOPLE);
    expect(score.verdict).toBe("void");
    expect(score.voidReason).toContain("read_source_records");
  });

  test("voids a question no session answered", () => {
    const score = scoreQuestion(QUESTION, ANSWER, undefined, [], PEOPLE);
    expect(score.verdict).toBe("void");
    expect(score.voidReason).toBe("no answer was recorded");
  });

  test("reports a name the corpus states only in _facts without counting it", () => {
    const unstated: SealedAnswer = { ...ANSWER, unstated_in_prose: ["Chris Jackson"] };
    const score = scoreQuestion(QUESTION, unstated, recorded("Mia Brown."), [], PEOPLE);
    // A system reading content alone could not have known it, so it stays correct.
    expect(score.verdict).toBe("correct");
    expect(score.missing).toEqual(["Chris Jackson"]);
    expect(score.unstatedInProse).toEqual(["Chris Jackson"]);
  });

  test("marks an answer that found nothing as wrong", () => {
    const score = scoreQuestion(QUESTION, ANSWER, recorded("NOT FOUND"), [], PEOPLE);
    expect(score.verdict).toBe("wrong");
    expect(score.found).toEqual([]);
  });

  test("keeps voided questions out of the accuracy it reports", () => {
    const questions = [QUESTION, { ...QUESTION, id: "q-0002" }];
    const answers = [ANSWER, { ...ANSWER, id: "q-0002" }];
    const result = scoreRun({
      questions,
      answers,
      recorded: [recorded("Mia Brown and Chris Jackson.")],
      pages: [],
      people: PEOPLE,
    });
    expect(result.correct).toBe(1);
    expect(result.void).toBe(1);
    // One of two questions answered, and it was right: 100% of what was scored.
    expect(result.accuracy).toBe(1);
  });
});
