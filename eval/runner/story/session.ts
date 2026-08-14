import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  EVAL_WORKSPACE,
  MCP_NAME,
  MCP_URL,
  ROOT,
  capture,
  createCodexProgressPrinter,
  executable,
  type EvalProvider,
} from "../agent.ts";
import type { ToolCallRecord, TurnToolActivity } from "./types.ts";

const MUTATION_TOOLS = new Set([
  "create_directory", "update_directory", "delete_directory",
  "create_page", "update_page", "archive_page", "move_page",
]);

export type StoryConversation = {
  send(input: { id: string; prompt: string }): Promise<TurnToolActivity>;
  close(): Promise<void>;
};

type CodexEvent = {
  type?: string;
  thread_id?: string;
  threadId?: string;
  item?: {
    id?: string;
    type?: string;
    tool?: string;
    status?: string;
    arguments?: Record<string, unknown>;
  };
};

function codexActivity(output: string): TurnToolActivity {
  const callsById = new Map<string, ToolCallRecord>();
  let anonymous = 0;
  for (const line of output.split("\n")) {
    let event: CodexEvent;
    try {
      event = JSON.parse(line) as CodexEvent;
    } catch {
      continue;
    }
    const item = event.item;
    if (item?.type !== "mcp_tool_call" || !item.tool) continue;
    const id = item.id ?? `anonymous-${anonymous++}`;
    if (event.type === "item.started") {
      callsById.set(id, { tool: item.tool, status: "attempted", arguments: item.arguments });
    } else if (event.type === "item.completed") {
      callsById.set(id, {
        tool: item.tool,
        status: item.status === "failed" ? "failed" : "succeeded",
        arguments: item.arguments,
      });
    }
  }
  return summarizeActivity([...callsById.values()]);
}

function summarizeActivity(calls: ToolCallRecord[]): TurnToolActivity {
  return {
    calls,
    anyContextUse: calls.length > 0,
    guidancePrepared: calls.some((call) => call.tool === "prepare_change" && call.status === "succeeded"),
    mutationAttempted: calls.some((call) => MUTATION_TOOLS.has(call.tool)),
    mutationSucceeded: calls.some((call) => MUTATION_TOOLS.has(call.tool) && call.status === "succeeded"),
  };
}

function threadIdFrom(output: string): string | undefined {
  for (const line of output.split("\n")) {
    try {
      const event = JSON.parse(line) as CodexEvent;
      const id = event.thread_id ?? event.threadId;
      if (id) return id;
    } catch {
      // Keep looking through the JSONL stream.
    }
  }
  return undefined;
}

async function runProcess(input: {
  binary: string;
  args: string[];
  prompt: string;
  cwd?: string;
  progress?: (line: string) => void;
}): Promise<{ stdout: string; stderr: string }> {
  const child = Bun.spawn([input.binary, ...input.args], {
    cwd: input.cwd ?? ROOT,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(input.prompt);
  child.stdin.end();
  const [stdoutChunks, stderrChunks, exitCode] = await Promise.all([
    capture(child.stdout, input.progress),
    capture(child.stderr),
    child.exited,
  ]);
  const stdout = stdoutChunks.join("");
  const stderr = stderrChunks.join("");
  if (exitCode !== 0) {
    throw new Error(`Agent turn failed with exit code ${exitCode}${stderr.trim() ? `:\n${stderr.trim()}` : ""}`);
  }
  return { stdout, stderr };
}

function codexConversation(runDirectory: string): StoryConversation {
  const binary = executable("codex");
  let threadId: string | undefined;
  return {
    async send({ id, prompt }) {
      const outputPath = join(runDirectory, `${id}-final.md`);
      const common = [
        "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--json",
        "--output-last-message", outputPath,
        "-c", 'approval_policy="never"',
        "-c", `mcp_servers.${MCP_NAME}.url="${MCP_URL}"`,
        "-c", `mcp_servers.${MCP_NAME}.required=true`,
        "-c", `mcp_servers.${MCP_NAME}.default_tools_approval_mode="approve"`,
        "-c", `mcp_servers.${MCP_NAME}.scopes=["mcp:access","offline_access"]`,
      ];
      const args = threadId
        ? ["exec", "resume", ...common, threadId, "-"]
        : ["exec", ...common, "--sandbox", "read-only", "-C", EVAL_WORKSPACE, "-"];
      const result = await runProcess({
        binary,
        args,
        prompt,
        progress: createCodexProgressPrinter(),
      });
      await Bun.write(join(runDirectory, `${id}-codex.jsonl`), result.stdout);
      await Bun.write(join(runDirectory, `${id}-codex.stderr.log`), result.stderr);
      if (!threadId) {
        threadId = threadIdFrom(result.stdout);
        if (!threadId) throw new Error(`Codex did not report a resumable thread id during ${id}.`);
      }
      return codexActivity(result.stdout);
    },
    async close() {},
  };
}

function claudeActivity(output: string): TurnToolActivity {
  const calls = new Map<string, ToolCallRecord>();
  for (const line of output.split("\n")) {
    let event: {
      message?: { content?: Array<{
        type?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
        tool_use_id?: string;
        is_error?: boolean;
      }> };
    };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }
    for (const block of event.message?.content ?? []) {
      if (block.type === "tool_use" && block.id && block.name?.startsWith(`mcp__${MCP_NAME}__`)) {
        calls.set(block.id, {
          tool: block.name.slice(`mcp__${MCP_NAME}__`.length),
          status: "attempted",
          arguments: block.input,
        });
      } else if (block.type === "tool_result" && block.tool_use_id) {
        const call = calls.get(block.tool_use_id);
        if (call) calls.set(block.tool_use_id, {
          ...call,
          status: block.is_error ? "failed" : "succeeded",
        });
      }
    }
  }
  return summarizeActivity([...calls.values()]);
}

function claudeConversation(runDirectory: string): StoryConversation {
  const binary = executable("claude");
  const sessionId = randomUUID();
  let started = false;
  const mcpConfig = JSON.stringify({ mcpServers: { [MCP_NAME]: { type: "http", url: MCP_URL } } });
  return {
    async send({ id, prompt }) {
      const args = [
        "-p",
        ...(started ? ["--resume", sessionId] : ["--session-id", sessionId]),
        "--strict-mcp-config", "--mcp-config", mcpConfig,
        "--permission-mode", "dontAsk", "--allowedTools", `mcp__${MCP_NAME}__*`,
        "--output-format", "stream-json", "--verbose",
      ];
      const result = await runProcess({ binary, args, prompt, cwd: EVAL_WORKSPACE });
      started = true;
      await Bun.write(join(runDirectory, `${id}-claude.jsonl`), result.stdout);
      await Bun.write(join(runDirectory, `${id}-claude.stderr.log`), result.stderr);
      return claudeActivity(result.stdout);
    },
    async close() {},
  };
}

export function openStoryConversation(provider: EvalProvider, runDirectory: string): StoryConversation {
  return provider === "codex" ? codexConversation(runDirectory) : claudeConversation(runDirectory);
}

export const storySessionInternals = { codexActivity, threadIdFrom };
