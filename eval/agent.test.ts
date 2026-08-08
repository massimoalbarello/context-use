import { describe, expect, test } from "bun:test";
import { createCodexProgressPrinter } from "./agent.ts";

/**
 * The live trace is how a run is watched, so it has to report what actually happened.
 * Two ways it has been wrong: a shared set of seen item ids silenced every day after the
 * first, because Codex numbers its items from zero on each run; and a failed write was
 * reported as a success, which double-counted the page the agent then retried.
 */

function trace(events: unknown[]): string[] {
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => void lines.push(line);
  try {
    const print = createCodexProgressPrinter();
    for (const event of events) print(JSON.stringify(event));
  } finally {
    console.log = log;
  }
  return lines;
}

const completedCall = (id: string, tool: string, args: object, extra: object = {}) => ({
  type: "item.completed",
  item: { id, type: "mcp_tool_call", tool, arguments: args, ...extra },
});

describe("codex progress trace", () => {
  test("reports each batch of records grouped by source", () => {
    const lines = trace([completedCall("item_1", "read_source_records", { limit: 100 }, {
      result: {
        content: [{
          type: "text",
          text: JSON.stringify({
            has_more: true,
            records: [
              { record_ref: "corpus:amara-life-v1:meeting/mtg-0000" },
              { record_ref: "corpus:amara-life-v1:slack/sl-0001" },
              { record_ref: "corpus:amara-life-v1:slack/sl-0002" },
            ],
          }),
        }],
      },
    })]);
    expect(lines[0]).toBe("  ← 3 records served, more in this day");
    expect(lines[1]).toContain("meeting");
    expect(lines[1]).toContain("mtg-0000");
    expect(lines[2]).toContain("sl-0001, sl-0002");
  });

  test("reports a failed call as a failure rather than a write", () => {
    const lines = trace([completedCall("item_1", "create_page", { path: "people/x/intro" }, {
      status: "failed",
      result: { content: [{ type: "text", text: "MCP error -32602: missing commit_message" }] },
    })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith("  ✗ create_page people/x/intro");
    expect(lines[0]).toContain("missing commit_message");
  });

  test("prints a repeated item once within a session but never across sessions", () => {
    const call = completedCall("item_1", "create_page", { path: "people/x/intro" });
    // Codex can emit the same completed item twice, so one session prints it once.
    expect(trace([call, call])).toEqual(["  ✓ Created page · people/x/intro"]);
    // A second day reuses `item_1` for different work, and must not be silenced.
    const printer = createCodexProgressPrinter();
    expect(printer).not.toBe(createCodexProgressPrinter());
    expect(trace([call])).toEqual(["  ✓ Created page · people/x/intro"]);
  });

  test("shows the agent's own account of the batch", () => {
    const lines = trace([{
      type: "item.completed",
      item: { id: "item_2", type: "agent_message", text: "Kept the meeting.\n\nDropped the chatter." },
    }]);
    expect(lines).toEqual(["  » Kept the meeting.", "  » Dropped the chatter."]);
  });

  test("names the page a knowledge-write preparation targets", () => {
    // `prepare_knowledge_write` uses `target_path`, so a `path`-only reader showed nothing.
    const lines = trace([completedCall("item_3", "prepare_knowledge_write", {
      target_path: "companies/acme/intro",
    })]);
    expect(lines).toEqual(["    · prepare companies/acme/intro"]);
  });

  test("ignores output that is not an event", () => {
    expect(trace(["not json" as unknown])).toEqual([]);
  });
});
