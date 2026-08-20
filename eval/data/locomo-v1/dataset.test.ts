import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  downloadLocomoDataset,
  ensureLocomoDataset,
  listLocomoConversations,
  parseLocomoDateTime,
  selectAndReadLocomoConversations,
  validateLocomoSelection,
} from "./dataset.ts";

function sample(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sample_id: id,
    conversation: {
      speaker_a: "Caroline",
      speaker_b: "Melanie",
      session_1: [
        { speaker: "Caroline", dia_id: "D1:1", text: "Hey Mel!" },
        { speaker: "Melanie", dia_id: "D1:2", text: "Hi!", blip_caption: "a dog on a wall" },
      ],
      session_1_date_time: "1:56 pm on 8 May, 2023",
      session_2: [{ speaker: "Caroline", dia_id: "D2:1", text: "I ran a charity race." }],
      session_2_date_time: "10:04 am on 19 June, 2023",
      // A date with no session body, which the pinned file really contains.
      session_9_date_time: "9:00 am on 1 July, 2023",
    },
    qa: [
      { question: "What did the race raise awareness for?", answer: "mental health", evidence: ["D2:1"], category: 4 },
      { question: "When did she run it?", answer: "19 June 2023", evidence: ["D2:1"], category: 2 },
      { question: "What did she realize?", adversarial_answer: "self-care matters", evidence: ["D2:1"], category: 5 },
    ],
    ...overrides,
  };
}

function datasetFile(samples: unknown[]): string {
  const directory = mkdtempSync(join(tmpdir(), "locomo-dataset-"));
  const path = join(directory, "locomo10.json");
  writeFileSync(path, JSON.stringify(samples));
  return path;
}

describe("LoCoMo session dates", () => {
  test("parses upstream's format into calendar fields", () => {
    expect(parseLocomoDateTime("1:56 pm on 8 May, 2023"))
      .toEqual({ timestamp: "2023-05-08T13:56:00.000Z", day: "2023-05-08" });
    expect(parseLocomoDateTime("12:30 am on 1 January, 2024").day).toBe("2024-01-01");
    expect(parseLocomoDateTime("12:15 pm on 3 July, 2023").timestamp).toBe("2023-07-03T12:15:00.000Z");
  });

  test("refuses a shape it does not recognize rather than guessing", () => {
    expect(() => parseLocomoDateTime("2023-05-08")).toThrow(/Unrecognized LoCoMo session date/);
  });
});

describe("reading a conversation", () => {
  const path = datasetFile([sample("conv-26"), sample("conv-30")]);

  test("keeps sessions in upstream's order and drops a date with no turns", () => {
    const [conversation] = selectAndReadLocomoConversations(path, { conversationId: "conv-26" });
    expect(conversation!.sessions.map((session) => session.number)).toEqual([1, 2]);
    expect(conversation!.speakerA).toBe("Caroline");
  });

  test("carries an image caption through", () => {
    const [conversation] = selectAndReadLocomoConversations(path, { conversationId: "conv-26" });
    expect(conversation!.sessions[0]!.turns[1]!.imageCaption).toBe("a dog on a wall");
  });

  test("answers category 5 from adversarial_answer and every other category from answer", () => {
    const [conversation] = selectAndReadLocomoConversations(path, { conversationId: "conv-26" });
    const byCategory = new Map(conversation!.questions.map((entry) => [entry.category, entry]));
    expect(byCategory.get(4)!.referenceAnswer).toBe("mental health");
    expect(byCategory.get(5)!.referenceAnswer).toBe("self-care matters");
    expect(byCategory.get(5)!.adversarial).toBe(true);
  });

  test("derives a stable question id from its position", () => {
    const [conversation] = selectAndReadLocomoConversations(path, { conversationId: "conv-26" });
    expect(conversation!.questions.map((entry) => entry.id))
      .toEqual(["conv-26-q001", "conv-26-q002", "conv-26-q003"]);
  });

  test("summarises without loading a question set twice", () => {
    const summaries = listLocomoConversations(path);
    expect(summaries.map((entry) => entry.sampleId)).toEqual(["conv-26", "conv-30"]);
    expect(summaries[0]).toMatchObject({ sessions: 2, turns: 3, questions: 3 });
    expect(summaries[0]!.byCategory[5]).toBe(1);
  });

  test("names an unknown conversation rather than returning fewer", () => {
    expect(() => selectAndReadLocomoConversations(path, { conversationId: "conv-99" })).toThrow(/Unknown LoCoMo conversation/);
  });

  test("refuses a category 5 row with no adversarial answer", () => {
    const broken = datasetFile([sample("conv-x", {
      qa: [{ question: "?", answer: "a", evidence: [], category: 5 }],
    })]);
    expect(() => selectAndReadLocomoConversations(broken, { conversationId: "conv-x" }))
      .toThrow(/has no reference answer/);
  });

  test("refuses a session whose date is missing", () => {
    const broken = datasetFile([sample("conv-y", {
      conversation: {
        speaker_a: "A",
        speaker_b: "B",
        session_1: [{ speaker: "A", dia_id: "D1:1", text: "hi" }],
      },
    })]);
    expect(() => selectAndReadLocomoConversations(broken, { conversationId: "conv-y" }))
      .toThrow(/has turns but no session date/);
  });
});

describe("downloading", () => {
  const bytes = new Uint8Array(2_805_274);
  const wrongSize = () => new Response(new Blob([new Uint8Array(10)]).stream(), { status: 200 });

  /**
   * The download hangs — it does not fail — if anything reads `response.body` before
   * `Bun.write` consumes it, so this is written with a timeout rather than a plain await.
   * A regression here would otherwise look like a slow network.
   */
  async function withinTimeout<T>(work: Promise<T>, label: string): Promise<T> {
    const outcome = await Promise.race([
      work.then((value) => ({ value }), (error: unknown) => ({ error })),
      new Promise<{ hung: true }>((resolve) => setTimeout(() => resolve({ hung: true }), 10_000)),
    ]);
    if ("hung" in outcome) throw new Error(`${label} never completed — the response body was consumed twice`);
    if ("error" in outcome) throw outcome.error;
    return outcome.value;
  }

  test("streams the response to disk instead of deadlocking on its body", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "locomo-download-")), "locomo10.json");
    // The right length but the wrong bytes, so the digest check is what rejects it.
    const fetcher = (async () =>
      new Response(new Blob([bytes]).stream(), { status: 200 })) as unknown as typeof fetch;
    await expect(withinTimeout(downloadLocomoDataset(path, fetcher), "download"))
      .rejects.toThrow(/Downloaded LoCoMo dataset does not match/);
    // And it left nothing behind, neither the file nor its temporary.
    expect(existsSync(path)).toBe(false);
  }, 20_000);

  test("reports an HTTP failure rather than writing a truncated file", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "locomo-download-")), "locomo10.json");
    const fetcher = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(withinTimeout(downloadLocomoDataset(path, fetcher), "download"))
      .rejects.toThrow(/HTTP 404/);
    expect(existsSync(path)).toBe(false);
  }, 20_000);

  test("rejects a short body without promoting it", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "locomo-download-")), "locomo10.json");
    await expect(withinTimeout(
      downloadLocomoDataset(path, wrongSize as unknown as typeof fetch),
      "download",
    )).rejects.toThrow(/does not match/);
    expect(existsSync(path)).toBe(false);
  }, 20_000);

  test("refuses a supplied path that is not the pinned dataset", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "locomo-supplied-")), "elsewhere.json");
    writeFileSync(path, "{}");
    await expect(ensureLocomoDataset({ path })).rejects.toThrow(/does not match the pinned/);
  });
});

describe("selection", () => {
  const path = datasetFile([sample("conv-26"), sample("conv-30")]);

  test("requires exactly one conversation selector", () => {
    expect(() => validateLocomoSelection({})).toThrow(/exactly one/);
    expect(() => validateLocomoSelection({ all: true, limit: 1 })).toThrow(/exactly one/);
    expect(() => validateLocomoSelection({ all: true })).not.toThrow();
  });

  test("a selected conversation always includes every question and session", () => {
    const [conversation] = selectAndReadLocomoConversations(path, { conversationId: "conv-26" });
    expect(conversation!.questions).toHaveLength(3);
    expect(conversation!.sessions).toHaveLength(2);
  });

  test("limit takes conversations in dataset order", () => {
    expect(selectAndReadLocomoConversations(path, { limit: 1 }).map((entry) => entry.sampleId))
      .toEqual(["conv-26"]);
  });
});
