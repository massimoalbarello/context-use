import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  LONGMEMEVAL_QUESTION_TYPES,
  listLongMemEvalCases,
  readLongMemEvalCases,
  selectLongMemEvalCases,
  validateLongMemEvalSelection,
  type LongMemEvalQuestionType,
} from "./dataset.ts";

function rawCase(id: string, questionType: LongMemEvalQuestionType) {
  return {
    question_id: id,
    question_type: questionType,
    question: `What happened in ${id}?`,
    answer: { text: `answer-${id}` },
    question_date: "2023/05/30 (Tue) 12:00",
    haystack_session_ids: [`${id}-one`, `${id}-two`],
    haystack_dates: ["2023/05/28 (Sun) 12:00", "2023/05/29 (Mon) 12:00"],
    haystack_sessions: [
      [{ role: "user", content: `first-${id}`, has_answer: false }],
      [{ role: "assistant", content: `second-${id}`, has_answer: true }],
    ],
    answer_session_ids: [`${id}-two`],
  };
}

function fixture(values: unknown[]): string {
  const path = join(mkdtempSync(join(tmpdir(), "longmemeval-data-")), "dataset.json");
  writeFileSync(path, JSON.stringify(values));
  return path;
}

describe("LongMemEval dataset boundary", () => {
  test("reads only selected atomic cases and strips upstream gold turn labels", () => {
    const path = fixture([
      rawCase("first", "single-session-user"),
      rawCase("second_abs", "knowledge-update"),
    ]);
    expect(listLongMemEvalCases(path)).toEqual([
      { questionId: "first", questionType: "single-session-user", abstention: false },
      { questionId: "second_abs", questionType: "knowledge-update", abstention: true },
    ]);

    const [entry] = readLongMemEvalCases(["second_abs"], path);
    expect(entry?.questionId).toBe("second_abs");
    expect(entry?.sessions).toHaveLength(2);
    expect(entry?.sessions[1]?.turns).toEqual([{ role: "assistant", content: "second-second_abs" }]);
    expect(entry?.answerSessionIds).toEqual(["second_abs-two"]);
  });

  test("requires an explicit bounded selector and can sample each question type", () => {
    const summaries = LONGMEMEVAL_QUESTION_TYPES.flatMap((questionType) => [0, 1].map((index) => ({
      questionId: `${questionType}-${index}`,
      questionType,
      abstention: false,
    })));
    expect(() => validateLongMemEvalSelection({})).toThrow(/Choose exactly one/);
    expect(() => validateLongMemEvalSelection({ limit: 1, all: true })).toThrow(/Choose exactly one/);
    expect(() => validateLongMemEvalSelection({ limit: 0 })).toThrow(/positive integer/);
    expect(selectLongMemEvalCases(summaries, { limit: 2 })).toEqual(summaries.slice(0, 2));
    expect(selectLongMemEvalCases(summaries, { stratify: 1 }).map((entry) => entry.questionType))
      .toEqual([...LONGMEMEVAL_QUESTION_TYPES]);
  });

  test("rejects histories whose gold points outside the supplied history", () => {
    const outside = rawCase("outside", "multi-session");
    outside.answer_session_ids = ["foreign-session"];
    expect(() => readLongMemEvalCases(["outside"], fixture([outside])))
      .toThrow(/outside its history/);

  });

  test("preserves upstream session order even when same-day timestamps are not sorted", () => {
    const unsorted = rawCase("unsorted", "temporal-reasoning");
    unsorted.haystack_dates.reverse();
    const [entry] = readLongMemEvalCases(["unsorted"], fixture([unsorted]));
    expect(entry?.sessions.map((session) => session.date)).toEqual(unsorted.haystack_dates);
  });

  test("preserves upstream duplicate sessions under stable private corpus ids", () => {
    const repeated = rawCase("repeated", "multi-session");
    repeated.haystack_session_ids[1] = repeated.haystack_session_ids[0]!;
    repeated.answer_session_ids = [repeated.haystack_session_ids[0]!];

    const [entry] = readLongMemEvalCases(["repeated"], fixture([repeated]));
    expect(entry?.sessions.map((session) => session.id)).toEqual([
      "repeated-one",
      "repeated-one--duplicate-2",
    ]);
    expect(entry?.answerSessionIds).toEqual(["repeated-one"]);
  });
});
