import { describe, expect, test } from "bun:test";
import { AutomationValidationError, nextCronOccurrence } from "../src/index.ts";

describe("cron evaluation", () => {
  test("evaluates a five-field expression in its persisted time zone", () => {
    const next = nextCronOccurrence("0 9 * * *", "Europe/London", new Date("2026-01-15T10:00:00Z"));
    expect(next.toISOString()).toBe("2026-01-16T09:00:00.000Z");
  });

  test("rejects seconds fields and invalid time zones", () => {
    expect(() => nextCronOccurrence("0 0 9 * * *", "UTC")).toThrow(AutomationValidationError);
    expect(() => nextCronOccurrence("0 9 * * *", "Nowhere/Imaginary")).toThrow(AutomationValidationError);
  });
});
