import { describe, expect, test } from "bun:test";
import {
  diaryDayForPage,
  diaryDayTitle,
  diaryDirectories,
  diaryLogStub,
} from "../src/diary.ts";

describe("diary day detection", () => {
  test("recognises a page inside a day folder", () => {
    expect(diaryDayForPage("about/diary/2026/07/27/services-digest")).toMatchObject({
      year: "2026",
      month: "07",
      day: "27",
      path: "about/diary/2026/07/27",
      logPath: "about/diary/2026/07/27/log",
    });
  });

  test("the day folder and the month above it are not pages inside a day", () => {
    expect(diaryDayForPage("about/diary/2026/07/27")).toBeNull();
    expect(diaryDayForPage("about/diary/2026/07/overview")).toBeNull();
  });

  test("ignores paths that only look like the diary", () => {
    expect(diaryDayForPage("about/diary/agents")).toBeNull();
    expect(diaryDayForPage("about/notes/2026/07/27/log")).toBeNull();
    expect(diaryDayForPage("about/diary/26/7/27/log")).toBeNull();
    expect(diaryDayForPage("about/diary/2026/13/27/log")).toBeNull();
  });
});

describe("computed titles", () => {
  test("a day reads as a date, not as a slug", () => {
    const day = diaryDayForPage("about/diary/2026/07/27/services-digest")!;
    expect(diaryDayTitle(day)).toBe("Monday, 27 July 2026");
  });

  test("titles every level the day hangs off", () => {
    const day = diaryDayForPage("about/diary/2026/01/01/services-digest")!;
    expect(diaryDirectories(day).map((directory) => [directory.path, directory.title])).toEqual([
      ["about/diary/2026", "2026"],
      ["about/diary/2026/01", "January 2026"],
      ["about/diary/2026/01/01", "Thursday, 1 January 2026"],
    ]);
  });
});

describe("the day's log", () => {
  test("is a real entry point, ready for the link that caused it to exist", () => {
    const day = diaryDayForPage("about/diary/2026/07/27/services-digest")!;
    const stub = diaryLogStub(day);
    expect(stub.path).toBe("about/diary/2026/07/27/log");
    expect(stub.title).toBe("Log — Monday, 27 July 2026");
    expect(stub.body_markdown).toContain("## Companion pages");
    expect(stub.summary).toContain("awaiting");
  });
});
