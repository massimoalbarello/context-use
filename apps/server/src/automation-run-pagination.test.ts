import { describe, expect, test } from "bun:test";
import { AutomationValidationError } from "@context-use/database";
import { decodeCompletedRunCursor, encodeCompletedRunCursor } from "./automation-run-pagination.ts";

describe("completed automation run cursors", () => {
  test("round-trips the completion timestamp and deterministic ID tie-breaker", () => {
    const cursor = {
      completedAt: new Date("2026-07-19T18:09:07.000Z"),
      id: "55555555-5555-4555-8555-555555555555",
    };

    expect(decodeCompletedRunCursor(encodeCompletedRunCursor(cursor))).toEqual(cursor);
  });

  test("rejects malformed and incomplete cursors", () => {
    expect(() => decodeCompletedRunCursor("not-a-cursor")).toThrow(AutomationValidationError);
    const incomplete = Buffer.from(JSON.stringify({ completed_at: "2026-07-19T18:09:07.000Z" })).toString("base64url");
    expect(() => decodeCompletedRunCursor(incomplete)).toThrow(AutomationValidationError);
  });
});
