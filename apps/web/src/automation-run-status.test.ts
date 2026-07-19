import { describe, expect, test } from "bun:test";
import { automationRunDisplayStatus } from "./automation-run-status.ts";
import type { AutomationRun } from "./types.ts";

function run(status: AutomationRun["status"], claimExpired: boolean) {
  return { status, claim_expired: claimExpired };
}

describe("automation run display status", () => {
  test("shows server-identified elapsed claims as expired", () => {
    expect(automationRunDisplayStatus(run("claimed", false))).toBe("claimed");
    expect(automationRunDisplayStatus(run("claimed", true))).toBe("expired");
  });

  test("does not reinterpret persisted non-claim states", () => {
    expect(automationRunDisplayStatus(run("ready", true))).toBe("ready");
    expect(automationRunDisplayStatus(run("succeeded", true))).toBe("succeeded");
    expect(automationRunDisplayStatus(run("failed", true))).toBe("failed");
  });
});
