import { describe, expect, test } from "bun:test";
import fixture from "../../data/locomo-v1/metrics.fixture.json" with { type: "json" };
import type { LocomoCategory } from "../../data/locomo-v1/dataset.ts";
import {
  amemF1,
  amemMetrics,
  AMEM_METRIC_NAMES,
  meanAmemMetrics,
  normalizeAnswer,
  officialAdversarialScore,
  officialMultiHopF1,
  officialReference,
  officialScore,
  treebankTokenize,
} from "./metrics.ts";

type FixtureCase = {
  prediction: string;
  reference: string;
  category: number;
  official_f1: number;
  amem: Record<string, number>;
};

const cases = fixture.cases as FixtureCase[];

/**
 * Every expected value here came out of the real Python scorers rather than out of this
 * port's own behaviour, so a drift in either direction fails rather than being blessed.
 */
describe("LoCoMo metric ports against upstream values", () => {
  test("normalizeAnswer matches upstream", () => {
    for (const [input, expected] of Object.entries(fixture.normalized as Record<string, string>)) {
      expect(normalizeAnswer(input)).toBe(expected);
    }
  });

  for (const entry of cases) {
    const label = `${entry.category} · ${entry.prediction.slice(0, 40) || "(empty)"}`;

    test(`official F1 · ${label}`, () => {
      expect(officialScore(entry.prediction, entry.reference, entry.category as LocomoCategory))
        .toBeCloseTo(entry.official_f1, 10);
    });

    test(`A-mem metrics · ${label}`, () => {
      const computed = amemMetrics(entry.prediction, entry.reference) as unknown as Record<string, number>;
      for (const name of AMEM_METRIC_NAMES) {
        expect(computed[name]).toBeCloseTo(entry.amem[name]!, 10);
      }
    });
  }
});

describe("LoCoMo per-category rules", () => {
  test("category 3 scores only the first semicolon-separated alternative", () => {
    expect(officialReference("Psychology; social work", 3)).toBe("Psychology");
    expect(officialReference("Psychology; social work", 4)).toBe("Psychology; social work");
  });

  test("category 1 credits each comma-separated sub-answer independently", () => {
    // Naming one of two required parts perfectly is half marks, not a token-overlap blur.
    expect(officialMultiHopF1("adoption agencies", "adoption agencies, foster care"))
      .toBeCloseTo(0.5, 10);
  });

  test("category 5 is scored on declining, not on the reference text", () => {
    expect(officialAdversarialScore("Not mentioned in the conversation")).toBe(1);
    expect(officialAdversarialScore("No information available.")).toBe(1);
    expect(officialAdversarialScore("She realized self-care is important")).toBe(0);
    // The reference is never consulted, which is why a category 5 row scores 1 here.
    expect(officialScore("not mentioned", "anything at all", 5)).toBe(1);
  });

  test("an empty answer scores zero rather than throwing", () => {
    expect(officialScore("", "mental health", 4)).toBe(0);
    expect(amemF1("", "mental health")).toBe(0);
  });
});

describe("the NLTK tokenizer port", () => {
  test("splits a run of two or more dots off the word", () => {
    expect(treebankTokenize("this console..")).toEqual(["this", "console", ".."]);
  });

  test("detaches a sentence-final period even mid-string", () => {
    expect(treebankTokenize("ears and paws. and remember")).toEqual(
      ["ears", "and", "paws", ".", "and", "remember"],
    );
  });

  test("holds an initialism together, the way Punkt does", () => {
    expect(treebankTokenize("j.k. rowling")).toEqual(["j.k.", "rowling"]);
    // Alone, the same string is sentence-final, so its period does detach.
    expect(treebankTokenize("j.k.")).toEqual(["j.k", "."]);
  });

  test("splits a leading quote that is not a contraction", () => {
    expect(treebankTokenize("'sleep'")).toEqual(["'", "sleep", "'"]);
    expect(treebankTokenize("john's partner")).toEqual(["john", "'s", "partner"]);
  });

  // The fixture is the real check; this states what "matched" covered, so a later
  // regeneration that shrank it is visible.
  test("is exercised by every fixture case", () => {
    expect(cases.length).toBeGreaterThan(400);
  });
});

describe("the two F1s are genuinely different functions", () => {
  // This is the whole reason both are computed: reporting one as the other would be wrong
  // by a wide margin on exactly the verbose answers a knowledge-base agent produces.
  test("stemming and article removal separate them", () => {
    const prediction = "The charity race raised awareness for mental health.";
    const reference = "mental health";
    expect(officialScore(prediction, reference, 4)).not.toBeCloseTo(amemF1(prediction, reference), 3);
  });
});

describe("aggregation", () => {
  test("averages every metric and survives an empty set", () => {
    const mean = meanAmemMetrics([
      amemMetrics("mental health", "mental health"),
      amemMetrics("nothing alike", "mental health"),
    ]);
    expect(mean.exact_match).toBeCloseTo(0.5, 10);
    expect(meanAmemMetrics([]).f1).toBe(0);
  });
});
