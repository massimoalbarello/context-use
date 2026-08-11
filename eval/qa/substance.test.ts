import { describe, expect, test } from "bun:test";
import type { PageSnapshot } from "../snapshot.ts";
import { measureSubstance, timelineEvents } from "./substance.ts";

/**
 * The instrument has to tell the two shapes of timeline event apart, because that
 * distinction is the whole reason it exists: one records what was established, the other
 * records only that a conversation happened.
 */

const page = (over: Partial<PageSnapshot>): PageSnapshot => ({
  id: "id", path: "p", version: 1, title: "", summary: "", body: "", ...over,
});

const timeline = (...lines: string[]) =>
  page({ path: "companies/acme/timeline", body: ["# Timeline", "", "## 2026", "", ...lines].join("\n") });

describe("timelineEvents", () => {
  test("reads the event lines and not the headings around them", () => {
    const pages = [timeline("### April", "", "- **9 April** — closed at $2M.", "- **8 April** — met.")];
    expect(timelineEvents(pages)).toHaveLength(2);
  });

  test("ignores pages that are not timelines", () => {
    expect(timelineEvents([page({ path: "companies/acme/intro", body: "- **9 April** — x" })])).toEqual([]);
  });
});

describe("measureSubstance", () => {
  test("counts an event that states a particular", () => {
    const pages = [timeline(
      "- **9 April** — ARR reached $2.1M, up 34% on the quarter.",
      "- **8 April** — runway is 8 months at the current burn.",
    )];
    const measured = measureSubstance(pages, []);
    expect(measured.withParticulars).toBe(2);
    expect(measured.narrating).toBe(0);
  });

  test("counts an event that only narrates the exchange", () => {
    const pages = [timeline(
      "- **9 April** — supplied cap-table context before diligence.",
      "- **8 April** — discussed the timeline and flagged concerns.",
    )];
    const measured = measureSubstance(pages, []);
    expect(measured.withParticulars).toBe(0);
    expect(measured.narrating).toBe(2);
  });

  test("credits a quoted phrase as a particular, since a term can be the fact", () => {
    const pages = [timeline(`- **9 April** — called the approach "orange-mode" operations.`)];
    expect(measureSubstance(pages, []).withParticulars).toBe(1);
  });

  test("counts distinct figures rather than mentions, so one number repeated is one fact", () => {
    const pages = [
      timeline("- **9 April** — ARR reached $2.1M."),
      page({ path: "companies/acme/intro", body: "Revenue was $2.1M in Q1, against $3M planned." }),
    ];
    expect(measureSubstance(pages, []).distinctFigures).toBe(2);
  });

  test("reports throughput per batch, because the average hides the collapse", () => {
    const measured = measureSubstance([], [
      { batch: "2026-04-17", records: 72, mutations: 4, yield: 4 / 72 },
      { batch: "2026-04-20", records: 6, mutations: 49, yield: 49 / 6 },
    ]);
    expect(measured.batches.map((b) => Math.round(b.yield * 100) / 100)).toEqual([0.06, 8.17]);
  });
});
