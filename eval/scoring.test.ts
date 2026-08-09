import { describe, expect, test } from "bun:test";
import { scoreDiary, scoreStep, type PageSnapshot } from "./scoring.ts";
import type { EvalStep } from "./scenarios/amara-novamind.ts";

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
const DIARY = "about/diary/2026/01/27/log";

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

  test("requires existing canonical pages and timelines to change on each step", () => {
    const pages = [
      page("companies/novamind/intro", "Led by [[people/chen-wei/intro|Chen Wei]]."),
      page("companies/novamind/timeline", timeline()),
      page("people/chen-wei/intro", "CEO of [[companies/novamind/intro|NovaMind]]."),
      page("people/chen-wei/timeline", timeline()),
      page(MEETING, "[[companies/novamind/intro|NovaMind]] [[people/chen-wei/intro|Chen Wei]]"),
    ];

    const score = scoreStep(step, pages, pages);
    expect(score.assertions.find((assertion) => assertion.id === "companies/novamind.intro-reconciled")?.passed).toBe(false);
    expect(score.assertions.find((assertion) => assertion.id === "people/chen-wei.timeline-reconciled")?.passed).toBe(false);
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

  test("reports a day the composer never wrote", () => {
    const score = scoreDiary([step], [page("companies/novamind/intro", "NovaMind makes chips.")]);
    expect(score.assertions.find((assertion) => assertion.id === "diary.2026-01-27.exists")?.passed).toBe(false);
    expect(score.assertions.find((assertion) => assertion.id === "diary.2026-01-27.companies/novamind")?.passed).toBe(false);
  });
});
