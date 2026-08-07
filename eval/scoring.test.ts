import { describe, expect, test } from "bun:test";
import { scoreStep, type PageSnapshot } from "./scoring.ts";
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

function page(path: string, body: string): PageSnapshot {
  return { id: path, path, version: 1, title: path, summary: path, body };
}

describe("knowledge eval scoring", () => {
  test("accepts a connected diary, meeting, and entity timelines", () => {
    const diary = "about/diary/2026/01/27/log";
    const meeting = "meetings/2026/01/2026-01-27_novamind/intro";
    const meetingDirectory = meeting.slice(0, -"/intro".length);
    const pages = [
      page(diary, `[[companies/novamind|NovaMind]] [[people/chen-wei|Chen]] [[${meetingDirectory}|Meeting]]`),
      page("companies/novamind/intro", "Led by [[people/chen-wei|Chen Wei]]."),
      page("companies/novamind/timeline", `[[${diary}|Diary]] [[${meetingDirectory}|Meeting]]`),
      page("people/chen-wei/intro", "CEO of [[companies/novamind|NovaMind]]."),
      page("people/chen-wei/timeline", `[[${diary}|Diary]] [[${meetingDirectory}|Meeting]]`),
      page(meeting, "[[companies/novamind|NovaMind]] [[people/chen-wei|Chen Wei]]"),
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
    expect(score.assertions.find((assertion) => assertion.id === "diary.exists")?.passed).toBe(false);
    expect(score.assertions.find((assertion) => assertion.id === "people/chen-wei.timeline")?.passed).toBe(false);
  });

  test("requires existing canonical pages and timelines to change on each step", () => {
    const diary = "about/diary/2026/01/27/log";
    const meeting = "meetings/2026/01/2026-01-27_novamind/intro";
    const pages = [
      page(diary, `[[companies/novamind/intro|NovaMind]] [[people/chen-wei/intro|Chen]] [[${meeting}|Meeting]]`),
      page("companies/novamind/intro", "Led by [[people/chen-wei/intro|Chen Wei]]."),
      page("companies/novamind/timeline", `[[${diary}|Diary]] [[${meeting}|Meeting]]`),
      page("people/chen-wei/intro", "CEO of [[companies/novamind/intro|NovaMind]]."),
      page("people/chen-wei/timeline", `[[${diary}|Diary]] [[${meeting}|Meeting]]`),
      page(meeting, "[[companies/novamind/intro|NovaMind]] [[people/chen-wei/intro|Chen Wei]]"),
    ];

    const score = scoreStep(step, pages, pages);
    expect(score.assertions.find((assertion) => assertion.id === "companies/novamind.intro-reconciled")?.passed).toBe(false);
    expect(score.assertions.find((assertion) => assertion.id === "people/chen-wei.timeline-reconciled")?.passed).toBe(false);
  });
});
