import { describe, expect, test } from "bun:test";
import type { PageSnapshot } from "../snapshot.ts";
import {
  type PublicQuery,
  type SealedAnswer,
} from "./questions.ts";
import { scoreQuestion, scoreRun, type RecordedAnswer } from "./score.ts";

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
