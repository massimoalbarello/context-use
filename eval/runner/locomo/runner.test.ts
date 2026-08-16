import { describe, expect, test } from "bun:test";
import type { LocomoConversation, LocomoQuestion } from "../../data/locomo-v1/dataset.ts";
import {
  askedLocomoQuestion,
  locomoAskInternals,
  locomoAskPrompt,
  NOT_MENTIONED,
  resolveLocomoAnswer,
} from "./ask.ts";
import { locomoJudgePrompt } from "./judge.ts";
import { EMPTY_AMEM_METRICS } from "./metrics.ts";
import { asOfDate, forbiddenQaTools, locomoRunnerInternals } from "./runner.ts";

function question(overrides: Partial<LocomoQuestion> = {}): LocomoQuestion {
  return {
    id: "conv-26-q001",
    index: 0,
    category: 4,
    categoryName: "single-hop",
    question: "What did the charity race raise awareness for?",
    referenceAnswer: "mental health",
    evidence: ["D2:1"],
    adversarial: false,
    ...overrides,
  };
}

describe("how a question is put", () => {
  test("categories 1, 3 and 4 are asked plainly", () => {
    expect(askedLocomoQuestion(question()).text).toBe(question().question);
  });

  test("category 2 carries upstream's date instruction", () => {
    const asked = askedLocomoQuestion(question({ category: 2 }));
    expect(asked.text).toContain("Use DATE of CONVERSATION to answer with an approximate date.");
  });

  test("category 5 is a forced choice against 'not mentioned'", () => {
    const asked = askedLocomoQuestion(question({ id: "q-a", category: 5, referenceAnswer: "self-care matters" }));
    expect(asked.text).toContain("Select the correct answer:");
    expect(asked.options).toBeDefined();
    expect([asked.options!.a, asked.options!.b].sort())
      .toEqual([NOT_MENTIONED, "self-care matters"].sort());
  });

  test("the option order is fixed by the question id, not by a coin flip", () => {
    const first = askedLocomoQuestion(question({ id: "conv-26-q003", category: 5 }));
    const again = askedLocomoQuestion(question({ id: "conv-26-q003", category: 5 }));
    expect(first.options).toEqual(again.options!);
    // And it is not the same order for every question, or the choice would be guessable.
    const orders = ["a", "b", "c", "d", "e", "f", "g", "h"]
      .map((id) => locomoAskInternals.realAnswerFirst(id));
    expect(new Set(orders).size).toBe(2);
  });

  test("the prompt bars source reads and names the date the agent should treat as now", () => {
    const prompt = locomoAskPrompt(askedLocomoQuestion(question()), "9:00 pm on 22 October, 2023");
    expect(prompt).toContain("Current date: 9:00 pm on 22 October, 2023");
    expect(prompt).toContain("Do not call read_source_records");
    expect(prompt).toContain("short phrase");
  });

  test("a category 5 prompt asks for the option rather than a short phrase", () => {
    const prompt = locomoAskPrompt(askedLocomoQuestion(question({ category: 5 })), "now");
    expect(prompt).toContain("Reply with the option you choose");
    expect(prompt).not.toContain("short phrase");
  });
});

describe("reading a category 5 answer back", () => {
  const asked = askedLocomoQuestion(question({ id: "conv-26-q003", category: 5, referenceAnswer: "self-care matters" }));

  test("expands a bare letter into the option it names", () => {
    expect(resolveLocomoAnswer(asked, "a")).toBe(asked.options!.a);
    expect(resolveLocomoAnswer(asked, "(B)")).toBe(asked.options!.b);
    expect(resolveLocomoAnswer(asked, " b. ")).toBe(asked.options!.b);
  });

  test("takes anything else at face value", () => {
    expect(resolveLocomoAnswer(asked, "Not mentioned in the conversation"))
      .toBe("Not mentioned in the conversation");
  });

  test("leaves other categories untouched beyond trimming", () => {
    expect(resolveLocomoAnswer(askedLocomoQuestion(question()), "  mental health\n")).toBe("mental health");
  });
});

describe("isolation", () => {
  test("only read-only knowledge tools are valid during QA", () => {
    expect(forbiddenQaTools(["search_pages", "get_page"])).toEqual([]);
    expect(forbiddenQaTools(["search_pages", "update_page", "read_source_records"]))
      .toEqual(["update_page", "read_source_records"]);
  });

  test("the served corpus path has to sit inside the repository", () => {
    expect(() => locomoRunnerInternals.containerPath("/etc")).toThrow(/must live below/);
  });

  test("the public question carries the asked text and no reference answer", () => {
    const asked = askedLocomoQuestion(question());
    const published = locomoRunnerInternals.publicQuestion(asked);
    expect(JSON.stringify(published)).not.toContain("mental health");
    expect(published.tags).toContain("single-hop");
  });
});

describe("the current date handed to the agent", () => {
  test("is the last session's, which is upstream's implicit present", () => {
    const conversation = {
      sampleId: "conv-26",
      speakerA: "A",
      speakerB: "B",
      sessions: [
        { number: 1, dateTime: "1:56 pm on 8 May, 2023", timestamp: "", day: "", turns: [] },
        { number: 2, dateTime: "9:00 pm on 22 October, 2023", timestamp: "", day: "", turns: [] },
      ],
      questions: [],
    } as unknown as LocomoConversation;
    expect(asOfDate(conversation)).toBe("9:00 pm on 22 October, 2023");
  });
});

describe("void questions stay in the denominator", () => {
  test("an A-mem average is scaled by how many questions were actually answered", () => {
    const perfect = { ...EMPTY_AMEM_METRICS, f1: 1, bleu1: 1 };
    // Two of four questions answered perfectly is 0.5, not 1.0.
    expect(locomoRunnerInternals.scaleAmem(perfect, 2, 4).f1).toBeCloseTo(0.5, 10);
    expect(locomoRunnerInternals.scaleAmem(perfect, 4, 4).bleu1).toBeCloseTo(1, 10);
    expect(locomoRunnerInternals.scaleAmem(perfect, 0, 0).f1).toBe(0);
  });
});

describe("the judge prompt", () => {
  test("asks whether the model declined, for an adversarial question", () => {
    const prompt = locomoJudgePrompt(
      { category: 5, question: "What did she realize?", referenceAnswer: "self-care matters" },
      "I could not find that.",
    );
    expect(prompt).toContain("correctly decline");
    expect(prompt).toContain("Unsupported claim: self-care matters");
  });

  test("scores an open-domain answer against the first alternative only", () => {
    const prompt = locomoJudgePrompt(
      { category: 3, question: "What would she study?", referenceAnswer: "Psychology; social work" },
      "psychology",
    );
    expect(prompt).toContain("Correct Answer: Psychology\n");
    expect(prompt).not.toContain("social work");
  });

  test("requires every part of a multi-hop answer", () => {
    const prompt = locomoJudgePrompt(
      { category: 1, question: "What did she research?", referenceAnswer: "adoption agencies, foster care" },
      "adoption agencies",
    );
    expect(prompt).toContain("every part");
  });
});
