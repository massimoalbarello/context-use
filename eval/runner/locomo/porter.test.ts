import { describe, expect, test } from "bun:test";
import fixture from "../../data/locomo-v1/metrics.fixture.json" with { type: "json" };
import { porterStem } from "./porter.ts";

/**
 * Every stem here was produced by the real `nltk.stem.PorterStemmer`, so this is a
 * comparison against upstream rather than against this port's own idea of correctness.
 */
describe("NLTK Porter stemmer port", () => {
  const stems = fixture.stems as Record<string, string>;

  test("matches NLTK on every word in the fixture vocabulary", () => {
    const wrong = Object.entries(stems)
      .filter(([word, expected]) => porterStem(word) !== expected)
      .map(([word, expected]) => `${word}: expected ${expected}, got ${porterStem(word)}`);
    expect(wrong).toEqual([]);
  });

  // The fixture is generated over every token in all 1,986 reference answers, so this
  // guards against a regeneration that quietly narrowed what the comparison covers.
  test("covers the vocabulary the metrics actually stem", () => {
    expect(Object.keys(stems).length).toBeGreaterThan(2000);
  });

  test("applies NLTK's irregular-form table rather than the rules", () => {
    expect(porterStem("skies")).toBe("sky");
    expect(porterStem("dying")).toBe("die");
    expect(porterStem("news")).toBe("news");
  });

  test("stems y to i only after a consonant", () => {
    expect(porterStem("happy")).toBe("happi");
    expect(porterStem("enjoy")).toBe("enjoy");
  });

  test("leaves words of two letters or fewer alone", () => {
    expect(porterStem("at")).toBe("at");
    expect(porterStem("a")).toBe("a");
  });

  test("lowercases before stemming", () => {
    expect(porterStem("Adoption")).toBe(porterStem("adoption"));
  });
});
