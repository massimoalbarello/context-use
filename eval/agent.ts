import { existsSync } from "node:fs";
import { join } from "node:path";
import { stackUrl } from "../scripts/local-stack.ts";
import { style, terminalWidth, truncate, wrapList } from "./terminal.ts";

/** Agent session plumbing shared by the scenario eval and the corpus distillation run. */

export type EvalProvider = "codex" | "claude";

export const ROOT = join(import.meta.dir, "..");
export const EVAL_URL = stackUrl();
export const MCP_NAME = "context_use_eval";
export const MCP_URL = `${EVAL_URL}/mcp`;
const CODEX_APP_BINARY = "/Applications/ChatGPT.app/Contents/Resources/codex";

export function executable(name: EvalProvider): string {
  const found = Bun.spawnSync(["sh", "-lc", `command -v ${name}`], { stdout: "pipe", stderr: "pipe" });
  const path = found.stdout.toString().trim();
  if (found.exitCode === 0 && path) return path;
  if (name === "codex" && existsSync(CODEX_APP_BINARY)) return CODEX_APP_BINARY;
  throw new Error(`${name} CLI was not found. Install it or add it to PATH.`);
}

export async function capture(
  stream: ReadableStream<Uint8Array>,
  onLine?: (line: string) => void,
): Promise<string[]> {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  let buffered = "";
  const reader = stream.getReader();
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    const text = decoder.decode(chunk, { stream: true });
    chunks.push(text);
    if (onLine) {
      buffered += text;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    }
  }
  const finalText = decoder.decode();
  if (finalText) {
    chunks.push(finalText);
    buffered += finalText;
  }
  if (onLine && buffered) onLine(buffered);
  return chunks;
}

/** Tools that change the knowledge base. Everything else is a read the agent used to decide. */
const WRITE_TOOLS = new Set(["create_directory", "create_page", "update_page", "archive_page"]);

/** One column for every tool name, so subjects line up whether the call read or wrote. */
const TOOL_COLUMN = "prepare_knowledge_write".length;

type ToolCallItem = {
  id?: string;
  type?: string;
  tool?: string;
  status?: string;
  arguments?: Record<string, unknown>;
  result?: { content?: { type?: string; text?: string }[] };
};

/**
 * The useful part of a failed call's result. MCP wraps the reason in two layers of
 * boilerplate that repeat the tool name already printed on the same line.
 */
function failureReason(item: ToolCallItem, budget: number): string {
  const text = item.result?.content?.find((entry) => entry.text)?.text ?? "";
  const reason = (text.split("\n")[0] ?? "")
    .replace(/^MCP error -?\d+:\s*/, "")
    .replace(/^Input validation error:\s*/, "")
    .replace(/^Invalid arguments for tool \w+:\s*/, "");
  return truncate(reason || "no reason reported", budget);
}


/** The argument worth seeing, in the order a reader would look for it. */
function callSubject(item: ToolCallItem): string {
  for (const key of ["path", "target_path", "query", "directory", "name", "skill"]) {
    const value = item.arguments?.[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

/**
 * Turns one `read_source_records` result into the batch the agent was just handed,
 * grouped by source so a day of eighty records stays a handful of lines.
 */
function batchLines(item: ToolCallItem): string[] {
  const text = item.result?.content?.find((entry) => entry.text)?.text;
  if (!text) return [];
  let parsed: { records?: { record_ref?: string }[]; has_more?: boolean };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return [];
  }
  const records = parsed.records ?? [];
  const grouped = new Map<string, string[]>();
  for (const record of records) {
    // `corpus:amara-life-v1:meeting/mtg-0000` reads better as `meeting mtg-0000`.
    const ref = (record.record_ref ?? "").replace(/^corpus:[^:]+:/, "");
    const separator = ref.indexOf("/");
    const source = separator === -1 ? "other" : ref.slice(0, separator);
    grouped.set(source, [...(grouped.get(source) ?? []), ref.slice(separator + 1)]);
  }
  const width = Math.max(...[...grouped.keys()].map((source) => source.length));
  // Built by concatenation rather than nesting: one style's reset ends the other early.
  const lines = [
    style.cyan("  ← ") + style.bold(String(records.length)) + style.cyan(" records served")
      + (parsed.has_more ? style.dim(" · more in this day") : ""),
  ];
  for (const [source, refs] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
    const indent = 8 + width + 2;
    const [first, ...rest] = wrapList(refs, indent);
    lines.push(
      `      ${style.cyan(source.padEnd(width))}  ${style.dim((first ?? "").trimStart())}`,
      ...rest.map((line) => style.dim(line)),
    );
  }
  return lines;
}

/**
 * Builds a live trace for one agent session: the records it is handed, what it says about
 * them, the pages it reads to decide, and every write it makes.
 *
 * There is deliberately no per-record outcome. The agent is handed a whole day at once and
 * reconciles the batch, and the pages it writes do not cite the record that prompted them,
 * so attributing a page to a record is not observable from the stream. What is observable
 * is the batch in, the agent's own account of what it kept, and the writes out.
 *
 * One printer per session, because Codex numbers its items from zero on every run: a
 * shared set of seen ids would suppress the second day onwards almost entirely.
 */
export function createCodexProgressPrinter(): (line: string) => void {
  // Codex can emit the same completed item more than once; print each one only once.
  const printed = new Set<string>();

  return (line: string): void => {
    let event: { type?: string; item?: ToolCallItem & { text?: string }; error?: { message?: string } };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      // Preserve non-JSON output in the log without flooding the terminal.
      return;
    }
    const item = event.item;

    if (event.type === "item.started" && item?.type === "mcp_tool_call"
      && item.tool === "read_source_records") {
      console.log(`\n${style.dim("  ← reading source records…")}`);
      return;
    }
    if (event.type?.includes("failed")) {
      console.error(style.red(`  Agent error: ${event.error?.message ?? line}`));
      return;
    }
    if (event.type !== "item.completed" || !item) return;
    if (item.id && printed.has(item.id)) return;
    if (item.id) printed.add(item.id);

    if (item.type === "agent_message" && item.text) {
      // The agent's own account of what it kept and why, which is the closest thing to a
      // result for the batch. Set apart so it reads as narration around the tool calls.
      console.log("");
      for (const paragraph of item.text.trim().split("\n")) {
        if (paragraph.trim()) console.log(`  ${style.yellow("»")} ${paragraph.trim()}`);
      }
      return;
    }
    if (item.type !== "mcp_tool_call" || !item.tool) return;

    // A failed call is followed by a retry, so reporting it as a write would count the
    // same page twice and hide that the agent had to correct itself.
    const tool = item.tool.padEnd(TOOL_COLUMN);
    if (item.status === "failed") {
      const subject = callSubject(item) || item.tool;
      const budget = terminalWidth() - TOOL_COLUMN - subject.length - 10;
      console.log(`  ${style.red("✗")} ${style.red(tool)} ${subject}  ${
        style.red(failureReason(item, Math.max(20, budget)))}`);
      return;
    }
    if (item.tool === "read_source_records") {
      for (const batchLine of batchLines(item)) console.log(batchLine);
    } else if (WRITE_TOOLS.has(item.tool)) {
      console.log(`  ${style.green("✓")} ${style.green(tool)} ${callSubject(item) || "(unknown path)"}`);
    } else {
      // Any other tool is a read. Naming it rather than relabelling it keeps the trace
      // honest about what the agent called, and new tools appear without code changes.
      console.log(style.dim(`    ${tool} ${callSubject(item)}`.trimEnd()));
    }
  };
}

export type AgentSession = {
  provider: EvalProvider;
  /** Stable identifier used to name this session's log files. */
  id: string;
  prompt: string;
  runDirectory: string;
};

async function runCodexSession({ id, prompt, runDirectory }: AgentSession): Promise<void> {
  const binary = executable("codex");
  const args = [
    "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules",
    "--skip-git-repo-check", "--sandbox", "read-only", "--json",
    "--output-last-message", join(runDirectory, `${id}-final.md`),
    "-C", join(ROOT, "eval", "workspace"),
    "-c", 'approval_policy="never"',
    "-c", `mcp_servers.${MCP_NAME}.url="${MCP_URL}"`,
    "-c", `mcp_servers.${MCP_NAME}.required=true`,
    "-c", `mcp_servers.${MCP_NAME}.default_tools_approval_mode="approve"`,
    "-c", `mcp_servers.${MCP_NAME}.scopes=["mcp:access","offline_access"]`,
    "-",
  ];
  const child = Bun.spawn([binary, ...args], {
    cwd: ROOT, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  child.stdin.write(prompt);
  child.stdin.end();
  const [stdoutChunks, stderrChunks, exitCode] = await Promise.all([
    capture(child.stdout, createCodexProgressPrinter()),
    capture(child.stderr),
    child.exited,
  ]);
  await Bun.write(join(runDirectory, `${id}-codex.jsonl`), stdoutChunks.join(""));
  await Bun.write(join(runDirectory, `${id}-codex.stderr.log`), stderrChunks.join(""));
  if (exitCode !== 0) {
    const stderr = stderrChunks.join("").trim();
    throw new Error(`Codex failed during ${id} with exit code ${exitCode}${stderr ? `:\n${stderr}` : ""}`);
  }
}

async function runClaudeSession({ id, prompt, runDirectory }: AgentSession): Promise<void> {
  const binary = executable("claude");
  const auth = Bun.spawnSync([binary, "auth", "status"], { stdout: "pipe", stderr: "pipe" });
  if (auth.exitCode !== 0 || !auth.stdout.toString().includes('"loggedIn": true')) {
    throw new Error("Claude Code is not logged in. Run `claude auth login`, then retry with --provider claude.");
  }
  const mcpConfig = JSON.stringify({ mcpServers: { [MCP_NAME]: { type: "http", url: MCP_URL } } });
  const child = Bun.spawn([
    binary, "-p", "--no-session-persistence", "--strict-mcp-config",
    "--mcp-config", mcpConfig, "--permission-mode", "dontAsk",
    "--allowedTools", `mcp__${MCP_NAME}__*`,
    // `stream-json` is what `finalAnswer` and `toolsUsed` read back, and under `-p` the
    // CLI only emits it with `--verbose`.
    "--output-format", "stream-json", "--verbose",
  ], { cwd: join(ROOT, "eval", "workspace"), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  child.stdin.write(prompt);
  child.stdin.end();
  const [stdoutChunks, stderrChunks, exitCode] = await Promise.all([
    capture(child.stdout),
    capture(child.stderr),
    child.exited,
  ]);
  await Bun.write(join(runDirectory, `${id}-claude.jsonl`), stdoutChunks.join(""));
  await Bun.write(join(runDirectory, `${id}-claude.stderr.log`), stderrChunks.join(""));
  if (exitCode !== 0) {
    const stderr = stderrChunks.join("").trim();
    throw new Error(`Claude failed during ${id} with exit code ${exitCode}${stderr ? `:\n${stderr}` : ""}`);
  }
}

export async function runAgentSession(session: AgentSession): Promise<void> {
  if (session.provider === "codex") await runCodexSession(session);
  else await runClaudeSession(session);
}

export function connectProvider(provider: EvalProvider): void {
  if (provider === "codex") {
    const child = Bun.spawnSync([
      executable("codex"), "mcp", "login", MCP_NAME,
      "--scopes", "mcp:access,offline_access",
      "-c", `mcp_servers.${MCP_NAME}.url="${MCP_URL}"`,
    ], { cwd: ROOT, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    if (child.exitCode !== 0) process.exit(child.exitCode);
    return;
  }
  const binary = executable("claude");
  const existing = Bun.spawnSync([binary, "mcp", "get", MCP_NAME], {
    cwd: ROOT, stdout: "ignore", stderr: "ignore",
  });
  if (existing.exitCode !== 0) {
    const added = Bun.spawnSync([
      binary, "mcp", "add", "--transport", "http", "--scope", "user", MCP_NAME, MCP_URL,
    ], { cwd: ROOT, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    if (added.exitCode !== 0) process.exit(added.exitCode);
  }
  console.log("Claude MCP configuration is ready.");
  console.log("Run `claude auth login` if needed, then open Claude Code and use `/mcp` once to complete OAuth.");
}
