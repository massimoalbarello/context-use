import type { AutomationRun } from "./types.ts";

export type AutomationRunDisplayStatus = AutomationRun["status"] | "expired";

export function automationRunDisplayStatus(
  run: Pick<AutomationRun, "status" | "claim_expired">,
): AutomationRunDisplayStatus {
  if (run.status === "claimed" && run.claim_expired) {
    return "expired";
  }
  return run.status;
}
