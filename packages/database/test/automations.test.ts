import { describe, expect, test } from "bun:test";
import { AutomationRepository, AutomationValidationError, nextCronOccurrence } from "../src/index.ts";
import {
  AUTOMATION_RUN_EXECUTION_CONTEXT,
  automationRunInstructionsMarkdown,
  hasAutomationExecutionContext,
} from "../src/automations.ts";

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

describe("automation run execution context", () => {
  test("detects an existing framework section", () => {
    const instructions = `Review the source material.

## Execution context

Legacy run handling instructions.
`;

    expect(hasAutomationExecutionContext(instructions)).toBe(true);
  });

  test("does not mistake an example inside a fenced block for framework context", () => {
    const instructions = `Explain this example:

\`\`\`markdown
## Execution context
Example content
\`\`\``;

    expect(hasAutomationExecutionContext(instructions)).toBe(false);
  });

  test("defines the claimed-run contract centrally", () => {
    expect(AUTOMATION_RUN_EXECUTION_CONTEXT).toContain("`claim_due_run`");
    expect(AUTOMATION_RUN_EXECUTION_CONTEXT).toContain("`create_automation_page`");
    expect(AUTOMATION_RUN_EXECUTION_CONTEXT).toContain("`update_automation_page`");
    expect(AUTOMATION_RUN_EXECUTION_CONTEXT).toContain("`complete_run`");
    expect(AUTOMATION_RUN_EXECUTION_CONTEXT).toContain("`fail_run`");
    expect(AUTOMATION_RUN_EXECUTION_CONTEXT).toContain("[[about/intro]]");
    expect(AUTOMATION_RUN_EXECUTION_CONTEXT).toContain("Do not create a page");
    expect(AUTOMATION_RUN_EXECUTION_CONTEXT).toContain("private by default");
    expect(AUTOMATION_RUN_EXECUTION_CONTEXT).toContain("only the owner can publish");
    expect(AUTOMATION_RUN_EXECUTION_CONTEXT).toContain("Never copy page contents into the summary");
  });

  test("injects the canonical context section into claimed-run instructions when absent", () => {
    const markdown = automationRunInstructionsMarkdown("Review today's activity.");

    expect(markdown).toContain("Review today's activity.");
    expect(markdown.match(/## Execution context/g)).toHaveLength(1);
    expect(markdown).toEndWith(AUTOMATION_RUN_EXECUTION_CONTEXT);
  });

  test("returns the same complete body for a claimed run's instruction field", () => {
    const instructions = automationRunInstructionsMarkdown("Review today's activity.");

    expect(instructions).toStartWith("Review today's activity.");
    expect(instructions).toEndWith(AUTOMATION_RUN_EXECUTION_CONTEXT);
    expect(instructions.match(/## Execution context/g)).toHaveLength(1);
  });

  test("leaves migrated legacy instructions untouched until the owner updates them", () => {
    const instructions = `Review today's activity.

## Execution context

Legacy run handling instructions.`;
    const markdown = automationRunInstructionsMarkdown(instructions);

    expect(markdown).toEndWith(instructions);
    expect(markdown.match(/## Execution context/g)).toHaveLength(1);
    expect(markdown).not.toContain("`claim_due_run`");
  });
});

describe("completed automation run pagination", () => {
  test("returns one bounded page and a cursor made from the last visible row", async () => {
    const completedAt = [
      new Date("2026-07-19T18:03:00.000Z"),
      new Date("2026-07-19T18:02:00.000Z"),
      new Date("2026-07-19T18:01:00.000Z"),
    ];
    const pool = {
      async query(sql: string, parameters?: unknown[]) {
        if (sql.includes("count(*) FILTER")) return { rows: [{ succeeded: 12, failed: 3 }] };
        expect(parameters).toEqual([3]);
        return { rows: completedAt.map((value, index) => ({ id: `run-${index + 1}`, completed_at: value })) };
      },
    };
    const repository = new AutomationRepository(pool as never);

    const page = await repository.listCompletedRuns(2);

    expect(page.items.map(({ id }) => id)).toEqual(["run-1", "run-2"]);
    expect(page.nextCursor).toEqual({ completedAt: completedAt[1]!, id: "run-2" });
    expect(page.totals).toEqual({ succeeded: 12, failed: 3 });
  });
});
