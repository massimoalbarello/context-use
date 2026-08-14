import { describe, expect, test } from "bun:test";
import { askPrompt } from "./ask.ts";

describe("QA prompt", () => {
  test("gives temporal questions their benchmark current date without leaking an answer", () => {
    const prompt = askPrompt({
      id: "temporal-1",
      tier: "hard",
      text: "How long ago did this happen?",
      expected_output_type: "time-qualified-answer",
      as_of_date: "2023/05/30 (Tue) 12:00",
    });
    expect(prompt).toContain("Current date: 2023/05/30 (Tue) 12:00");
    expect(prompt).toContain("Question: How long ago did this happen?");
    expect(prompt).not.toContain("Correct Answer");
  });
});
