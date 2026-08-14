import { describe, expect, test } from "bun:test";
import { agentRunnerInternals, createCodexProgressPrinter } from "./agent.ts";

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
  test("reports the size and continuation state of each served batch", () => {
    const lines = trace([completedCall("item_1", "read_source_records", { limit: 100 }, {
      result: {
        content: [{
          type: "text",
          text: JSON.stringify({
            has_more: true,
            records: [
              { action: "added", markdown: "# Meeting" },
              { action: "added", markdown: "# Message one" },
              { action: "added", markdown: "# Message two" },
            ],
          }),
        }],
      },
    })]);
    expect(lines).toEqual(["  ← 3 records served · more in this day"]);
  });

  test("reports a failed call as a failure rather than a write", () => {
    const lines = trace([completedCall("item_1", "create_page", { path: "people/x/intro" }, {
      status: "failed",
      result: { content: [{ type: "text", text: "MCP error -32602: missing commit_message" }] },
    })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith("  ✗ ");
    expect(lines[0]).toContain("people/x/intro");
    // The MCP boilerplate repeating the tool name is stripped; the reason survives.
    expect(lines[0]).toContain("missing commit_message");
    expect(lines[0]).not.toContain("Invalid arguments for tool");
  });

  test("prints a repeated item once within a session but never across sessions", () => {
    const call = completedCall("item_1", "create_page", { path: "people/x/intro" });
    // Codex can emit the same completed item twice, so one session prints it once.
    expect(trace([call, call])).toEqual(["  ✓ create_page           people/x/intro"]);
    // A second day reuses `item_1` for different work, and must not be silenced.
    const printer = createCodexProgressPrinter();
    expect(printer).not.toBe(createCodexProgressPrinter());
    expect(trace([call])).toEqual(["  ✓ create_page           people/x/intro"]);
  });

  test("shows the agent's own account of the batch", () => {
    const lines = trace([{
      type: "item.completed",
      item: { id: "item_2", type: "agent_message", text: "Kept the meeting.\n\nDropped the chatter." },
    }]);
    expect(lines).toEqual(["", "  » Kept the meeting.", "  » Dropped the chatter."]);
  });

  test("names the page a change preparation targets", () => {
    // `prepare_change` uses `target_path`, so a `path`-only reader showed nothing.
    const lines = trace([completedCall("item_3", "prepare_change", {
      target_path: "companies/acme/intro",
    })]);
    expect(lines).toEqual(["    prepare_change        companies/acme/intro"]);
  });

  test("shows a tool it has never seen rather than dropping it", () => {
    // Reads are anything that is not a write, so a new tool needs no code change.
    expect(trace([completedCall("item_4", "some_new_tool", { path: "a/b" })]))
      .toEqual(["    some_new_tool         a/b"]);
  });

  test("ignores output that is not an event", () => {
    expect(trace(["not json" as unknown])).toEqual([]);
  });
});

describe("MCP-free evaluator sessions", () => {
  const session = {
    provider: "codex" as const,
    id: "judge-one",
    prompt: "yes or no",
    runDirectory: "/tmp/judge",
    knowledgeTools: false,
  };

  test("does not configure the knowledge MCP for Codex", () => {
    expect(agentRunnerInternals.codexArgs(session).join(" ")).not.toContain("context_use_eval");
  });

  test("gives Claude an empty MCP config and empty allowed-tools list", () => {
    const args = agentRunnerInternals.claudeArgs({ ...session, provider: "claude" });
    expect(args[args.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("");
  });
});
