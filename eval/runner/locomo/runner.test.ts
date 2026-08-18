import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { agentToolCalls, agentToolsUsed } from "../agent.ts";
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
import { asOfDate, bareToolName, forbiddenQaTools, locomoRunnerInternals } from "./runner.ts";

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

  /**
   * The token F1 counts every token the answer carries, so markdown and quoting are scored
   * as if they were wrong content. Every category needs this, category 5 included, because
   * its scorer looks for the phrase "not mentioned" in the reply.
   */
  test("every category is told to answer in plain text", () => {
    for (const category of [1, 2, 3, 4, 5] as const) {
      const prompt = locomoAskPrompt(askedLocomoQuestion(question({ category })), "now");
      expect(prompt).toContain("Answer in plain text");
      expect(prompt).toContain("Do not use Markdown");
      expect(prompt).toContain("do not explain your reasoning");
    }
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
    expect(forbiddenQaTools(["search_pages", "read_page", "browse_directory"])).toEqual([]);
    expect(forbiddenQaTools(["search_pages", "update_page", "read_source_records"]))
      .toEqual(["update_page", "read_source_records"]);
  });

  /**
   * The exact tool list an observed Claude Code answer produced. Every one of these is
   * read-only, and the first version of this allowlist voided all twenty questions of a
   * ninety-minute run because it compared bare names against qualified ones and spelled
   * the read tools `get_page`/`get_directory`, which no server exposes.
   */
  test("accepts what Claude Code actually reports", () => {
    expect(forbiddenQaTools([
      "ToolSearch",
      "mcp__context_use_eval__browse_directory",
      "mcp__context_use_eval__read_page",
      "mcp__context_use_eval__search_pages",
    ])).toEqual([]);
  });

  test("still rejects a mutating or source-reading tool when it is qualified", () => {
    expect(forbiddenQaTools([
      "mcp__context_use_eval__search_pages",
      "mcp__context_use_eval__update_page",
      "mcp__context_use_eval__read_source_records",
    ])).toEqual([
      "mcp__context_use_eval__update_page",
      "mcp__context_use_eval__read_source_records",
    ]);
  });

  /**
   * Observed in a real run: Claude Code emitted `mcp__context_use_eval` with the tool name
   * missing, then immediately retried the same read correctly. The call never executed, so
   * voiding a correct answer over it is wrong.
   */
  test("a namespaced name with no tool is a failed emission, not a violation", () => {
    expect(forbiddenQaTools([
      "mcp__context_use_eval__search_pages",
      "mcp__context_use_eval",
      "mcp__context_use_eval__read_page",
    ])).toEqual([]);
  });

  test("a foreign server's bare prefix is still forbidden", () => {
    expect(forbiddenQaTools(["mcp__other_server"])).toEqual(["mcp__other_server"]);
  });

  test("bareToolName strips only this server's prefix", () => {
    expect(bareToolName("mcp__context_use_eval__read_page")).toBe("read_page");
    expect(bareToolName("read_page")).toBe("read_page");
    expect(bareToolName("mcp__other_server__read_page")).toBe("mcp__other_server__read_page");
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

describe("what a question cost", () => {
  test("agentToolCalls counts repeats where agentToolsUsed only sees the set", () => {
    const directory = mkdtempSync(join(tmpdir(), "locomo-calls-"));
    const id = "qa-x";
    writeFileSync(join(directory, `${id}-claude.jsonl`), [
      JSON.stringify({ message: { content: [{ type: "tool_use", name: "mcp__context_use_eval__search_pages" }] } }),
      JSON.stringify({ message: { content: [{ type: "tool_use", name: "mcp__context_use_eval__search_pages" }] } }),
      JSON.stringify({ message: { content: [{ type: "tool_use", name: "mcp__context_use_eval__read_page" }] } }),
    ].join("\n"));
    expect(agentToolCalls(directory, id, "claude")).toEqual({
      "mcp__context_use_eval__search_pages": 2,
      "mcp__context_use_eval__read_page": 1,
    });
    // The set form cannot express that difference, which is why both exist.
    expect(agentToolsUsed(directory, id, "claude")).toHaveLength(2);
  });

  test("returns nothing rather than throwing when a transcript is missing", () => {
    expect(agentToolCalls(mkdtempSync(join(tmpdir(), "locomo-empty-")), "absent", "claude")).toEqual({});
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
