import { describe, expect, test } from "bun:test";
import { scoreDiary, scoreStep, type PageSnapshot } from "./scoring.ts";
import type { EvalStep } from "./scenario.ts";

const step: EvalStep = {
  id: "meeting",
  date: "2026-01-27",
  sourceType: "meeting",
  title: "Meeting",
  source: "source",
  entities: [
    { path: "companies/novamind", label: "NovaMind" },
    { path: "people/chen-wei", label: "Chen Wei", companyPath: "companies/novamind" },
  ],
  meetingExpected: true,
};

const MEETING = "meetings/2026/01/2026-01-27_novamind/intro";
const MEETING_DIRECTORY = MEETING.slice(0, -"/intro".length);
const DIARY = "about/diary/2026/01/27/intro";

function page(path: string, body: string): PageSnapshot {
  return { id: path, path, version: 1, title: path, summary: path, body };
}

function timeline(): string {
  return `## 2026\n\n### January\n\n- **27 January** — [[${MEETING_DIRECTORY}|Meeting]] — agreed to proceed.`;
}

describe("knowledge eval scoring", () => {
  test("accepts entity timelines carrying the day's dated entry", () => {
    const pages = [
      page("companies/novamind/intro", "Led by [[people/chen-wei|Chen Wei]]."),
      page("companies/novamind/timeline", timeline()),
      page("people/chen-wei/intro", "CEO of [[companies/novamind|NovaMind]]."),
      page("people/chen-wei/timeline", timeline()),
      page(MEETING, "[[companies/novamind|NovaMind]] [[people/chen-wei|Chen Wei]]"),
    ];

    const score = scoreStep(step, pages);
    expect(score.passed).toBe(score.total);
  });

  test("reports isolated temporal knowledge", () => {
    const pages = [
      page("companies/novamind/intro", "NovaMind makes chips."),
      page("people/chen-wei/intro", "Chen is CEO."),
    ];

    const score = scoreStep(step, pages);
    expect(score.passed).toBeLessThan(score.total);
    expect(score.assertions.find((assertion) => assertion.id === "people/chen-wei.timeline")?.passed).toBe(false);
    expect(score.assertions.find((assertion) => assertion.id === "people/chen-wei.timeline-dated")?.passed).toBe(false);
  });

  test("rejects a timeline that links the diary the composer owns", () => {
    const pages = [
      page("companies/novamind/intro", "Led by [[people/chen-wei|Chen Wei]]."),
      page("companies/novamind/timeline", `${timeline()} [[${DIARY}|Diary]]`),
      page("people/chen-wei/intro", "CEO of [[companies/novamind|NovaMind]]."),
      page("people/chen-wei/timeline", timeline()),
      page(MEETING, "[[companies/novamind|NovaMind]] [[people/chen-wei|Chen Wei]]"),
    ];

    const score = scoreStep(step, pages);
    expect(score.assertions.find((assertion) => assertion.id === "companies/novamind.no-diary-link")?.passed).toBe(false);
    expect(score.assertions.find((assertion) => assertion.id === "people/chen-wei.no-diary-link")?.passed).toBe(true);
  });

  test("requires an existing timeline to change on each step", () => {
    const pages = [
      page("companies/novamind/intro", "Led by [[people/chen-wei/intro|Chen Wei]]."),
      page("companies/novamind/timeline", timeline()),
      page("people/chen-wei/intro", "CEO of [[companies/novamind/intro|NovaMind]]."),
      page("people/chen-wei/timeline", timeline()),
      page(MEETING, "[[companies/novamind/intro|NovaMind]] [[people/chen-wei/intro|Chen Wei]]"),
    ];

    const score = scoreStep(step, pages, pages);
    expect(score.assertions.find((assertion) => assertion.id === "people/chen-wei.timeline-reconciled")?.passed).toBe(false);
  });

  test("accepts an as-of date on a canonical page but not a bare status", () => {
    const asOf = page("companies/novamind/intro", "Builds inference silicon — as of 20 February 2026.");
    const status = page("people/chen-wei/intro", "Reported $2.1M ARR in Q1 and moved to diligence in March 2026.");
    const pages = [
      asOf,
      page("companies/novamind/timeline", timeline()),
      status,
      page("people/chen-wei/timeline", timeline()),
      page(MEETING, "[[companies/novamind|NovaMind]] [[people/chen-wei|Chen Wei]]"),
    ];

    const score = scoreStep(step, pages);
    expect(score.assertions.find((assertion) => assertion.id === "companies/novamind.intro-undated")?.passed).toBe(true);
    const failed = score.assertions.find((assertion) => assertion.id === "people/chen-wei.intro-undated");
    expect(failed?.passed).toBe(false);
    expect(failed?.evidence).toBe("Q1, March 2026");
  });

  test("scores the composed diary in the direction the links run", () => {
    const pages = [
      page(DIARY, `[[companies/novamind|NovaMind]] [[people/chen-wei|Chen]] [[${MEETING_DIRECTORY}|Meeting]]`),
      page("companies/novamind/intro", "Led by Chen Wei."),
      page("people/chen-wei/intro", "CEO of NovaMind."),
      page(MEETING, "[[companies/novamind|NovaMind]] [[people/chen-wei|Chen Wei]]"),
    ];

    const score = scoreDiary([step], pages);
    expect(score.passed).toBe(score.total);
  });

  test("walks connected day views instead of requiring every entity link on the intro", () => {
    const view = "about/diary/2026/01/27/novamind-review";
    const pages = [
      page(DIARY, `The diligence work has its own [[${view}|account]].`),
      page(view, `[[companies/novamind|NovaMind]] [[people/chen-wei|Chen]] [[${MEETING_DIRECTORY}|Meeting]]`),
      page("companies/novamind/intro", "Led by Chen Wei."),
      page("people/chen-wei/intro", "CEO of NovaMind."),
      page(MEETING, "[[companies/novamind|NovaMind]] [[people/chen-wei|Chen Wei]]"),
    ];

    const score = scoreDiary([step], pages);
    expect(score.passed).toBe(score.total);
  });

  test("does not count an orphaned day view as part of the diary", () => {
    const pages = [
      page(DIARY, "A short day."),
      page("about/diary/2026/01/27/orphan", `[[companies/novamind|NovaMind]]`),
    ];

    const score = scoreDiary([step], pages);
    expect(score.assertions.find((assertion) => assertion.id === "diary.2026-01-27.companies/novamind")?.passed)
      .toBe(false);
  });

  test("reports a day the composer never wrote", () => {
    const score = scoreDiary([step], [page("companies/novamind/intro", "NovaMind makes chips.")]);
    expect(score.assertions.find((assertion) => assertion.id === "diary.2026-01-27.exists")?.passed).toBe(false);
    expect(score.assertions.find((assertion) => assertion.id === "diary.2026-01-27.companies/novamind")?.passed).toBe(false);
  });
});
