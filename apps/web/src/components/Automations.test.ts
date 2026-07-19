import { describe, expect, test } from "bun:test";
import type { AutomationRun } from "../types.ts";
import { appendUniqueRuns, isLongRunOutcome } from "./Automations.tsx";

describe("automation run outcomes", () => {
  test("leaves concise summaries inline", () => {
    expect(isLongRunOutcome("Saved the daily digest to the automation knowledge page.")).toBe(false);
  });

  test("collapses verbose or multi-line historical outcomes", () => {
    expect(isLongRunOutcome("x".repeat(181))).toBe(true);
    expect(isLongRunOutcome("One\nTwo\nThree\nFour")).toBe(true);
  });

  test("appends older pages without duplicating a cursor-boundary run", () => {
    const run = (id: string) => ({ id }) as AutomationRun;
    expect(appendUniqueRuns(
      [run("newest"), run("boundary")],
      [run("boundary"), run("oldest")],
    ).map(({ id }) => id)).toEqual(["newest", "boundary", "oldest"]);
  });
});
