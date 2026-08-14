import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stackUrl } from "../../scripts/local-stack.ts";
import { style, terminalWidth, truncate } from "./terminal.ts";

/** Agent session plumbing shared by corpus distillation and question answering. */

export const PROVIDERS = ["codex", "claude"] as const;
export type EvalProvider = (typeof PROVIDERS)[number];

/**
 * The CLI that drives the agent and the model it drives.
 *
 * Both belong together because neither alone describes what was measured: the same corpus
 * run through Codex and through Claude Code, or through two models of one CLI, produces
 * scores that are not comparable. Every run records the pair for that reason.
 */
export type EvalHarness = {
  provider: EvalProvider;
  /** Model id handed to the CLI. Omitted leaves the CLI on its own default. */
  model?: string | undefined;
};

export function harnessLabel(harness: EvalHarness): string {
  return `${harness.provider} · ${harness.model ?? "CLI default model"}`;
}

export function modelArguments(harness: EvalHarness): string[] {
  return harness.model ? ["--model", harness.model] : [];
}

/**
 * The flags that keep local configuration out of a measurement.
 *
 * The workspace sits inside this repository, so both CLIs will otherwise read this
 * repository's own instructions to its maintainers and hand them to the agent under test.
 * `--ignore-user-config` drops `$CODEX_HOME/config.toml`, where a developer's model,
 * reasoning effort, sandbox policy and extra MCP servers live, and `--ignore-rules` drops
 * execpolicy `.rules`; neither touches `AGENTS.md`, which Codex reads from the working
 * directory upward until `project_doc_max_bytes=0`. `--setting-sources ""` is Claude Code's
 * equivalent, covering its settings, memory and skills at once.
 *
 * None of it affects the MCP server's own `instructions`, which arrive over the wire at
 * initialize: Claude Code carries them into context and Codex discards them either way.
 */
export const CODEX_ISOLATION = ["--ignore-user-config", "--ignore-rules", "-c", "project_doc_max_bytes=0"];
export const CLAUDE_ISOLATION = ["--setting-sources", ""];

export const ROOT = join(import.meta.dir, "..", "..");
export const EVAL_URL = stackUrl();
export const MCP_NAME = "context_use_eval";
export const MCP_URL = `${EVAL_URL}/mcp`;
export const EVAL_WORKSPACE = join(import.meta.dir, "workspace");
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
const TOOL_COLUMN = "compare_page_versions".length;

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

/** Turns one `read_source_records` result into a compact count for the live trace. */
function batchLines(item: ToolCallItem): string[] {
  const text = item.result?.content?.find((entry) => entry.text)?.text;
  if (!text) return [];
  let parsed: { records?: unknown[]; has_more?: boolean };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return [];
  }
  const records = parsed.records ?? [];
  return [
    style.cyan("  ← ") + style.bold(String(records.length)) + style.cyan(" records served")
      + (parsed.has_more ? style.dim(" · more in this day") : ""),
  ];
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
  harness: EvalHarness;
  /** Stable identifier used to name this session's log files. */
  id: string;
  prompt: string;
  runDirectory: string;
  /** Knowledge MCP access is opt-out for tool-free evaluator sessions. */
  knowledgeTools?: boolean | undefined;
};

function codexArgs({ harness, id, runDirectory, knowledgeTools = true }: AgentSession): string[] {
  const mcpArgs = knowledgeTools
    ? [
        "-c", `mcp_servers.${MCP_NAME}.url="${MCP_URL}"`,
        "-c", `mcp_servers.${MCP_NAME}.required=true`,
        "-c", `mcp_servers.${MCP_NAME}.default_tools_approval_mode="approve"`,
        "-c", `mcp_servers.${MCP_NAME}.scopes=["mcp:access","offline_access"]`,
      ]
    : [];
  return [
    "exec", ...modelArguments(harness), "--ephemeral", ...CODEX_ISOLATION,
    "--skip-git-repo-check", "--sandbox", "read-only", "--json",
    "--output-last-message", join(runDirectory, `${id}-final.md`),
    "-C", EVAL_WORKSPACE,
    "-c", 'approval_policy="never"',
    ...mcpArgs,
    "-",
  ];
}

async function runCodexSession(session: AgentSession): Promise<void> {
  const { id, prompt, runDirectory } = session;
  const binary = executable("codex");
  const args = codexArgs(session);
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

function claudeArgs({ harness, knowledgeTools = true }: AgentSession): string[] {
  const mcpConfig = JSON.stringify({
    mcpServers: knowledgeTools ? { [MCP_NAME]: { type: "http", url: MCP_URL } } : {},
  });
  return [
    "-p", "--no-session-persistence", ...modelArguments(harness), ...CLAUDE_ISOLATION,
    "--strict-mcp-config",
    "--mcp-config", mcpConfig, "--permission-mode", "dontAsk",
    "--allowedTools", knowledgeTools ? `mcp__${MCP_NAME}__*` : "",
    // `stream-json` is what `agentFinalAnswer` and `agentToolsUsed` read back, and under
    // `-p` the CLI only emits it with `--verbose`.
    "--output-format", "stream-json", "--verbose",
  ];
}

async function runClaudeSession(session: AgentSession): Promise<void> {
  const { id, prompt, runDirectory } = session;
  const binary = executable("claude");
  const auth = Bun.spawnSync([binary, "auth", "status"], { stdout: "pipe", stderr: "pipe" });
  if (auth.exitCode !== 0 || !auth.stdout.toString().includes('"loggedIn": true')) {
    throw new Error("Claude Code is not logged in. Run `claude auth login`, then retry with --provider claude.");
  }
  const child = Bun.spawn([binary, ...claudeArgs(session)], {
    cwd: EVAL_WORKSPACE, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
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
  if (session.harness.provider === "codex") await runCodexSession(session);
  else await runClaudeSession(session);
}

/** Every provider action a session called, read back from its own transcript. */
export function agentToolsUsed(runDirectory: string, id: string, provider: EvalProvider): string[] {
  const path = join(runDirectory, `${id}-${provider}.jsonl`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const tools = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        item?: { type?: string; tool?: string };
        message?: { content?: Array<{ type?: string; name?: string }> };
      };
      const item = event.item;
      if (item?.type === "mcp_tool_call" && item.tool) tools.add(item.tool);
      else if (item?.type && !["agent_message", "reasoning"].includes(item.type)) tools.add(item.type);
      for (const block of event.message?.content ?? []) {
        if (block.type === "tool_use") tools.add(block.name ?? "tool_use");
      }
    } catch {
      continue;
    }
  }
  return [...tools].sort();
}

/** The final message a session produced, verbatim. */
export function agentFinalAnswer(runDirectory: string, id: string, provider: EvalProvider): string {
  if (provider === "codex") {
    try {
      return readFileSync(join(runDirectory, `${id}-final.md`), "utf8").trim();
    } catch {
      return "";
    }
  }
  let raw: string;
  try {
    raw = readFileSync(join(runDirectory, `${id}-claude.jsonl`), "utf8");
  } catch {
    return "";
  }
  let answer = "";
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { type?: string; result?: unknown; is_error?: boolean };
      if (event.type === "result" && !event.is_error && typeof event.result === "string") {
        answer = event.result;
      }
    } catch {
      continue;
    }
  }
  return answer.trim();
}

export const agentRunnerInternals = { codexArgs, claudeArgs };

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
  // The evaluation sessions pass this server inline with `--strict-mcp-config`, so the
  // registration above is not what they read. The stored OAuth token is, and this is the
  // flow that obtains it: the local stack has to be up, and the browser asks for the owner
  // passkey.
  const login = Bun.spawnSync([binary, "mcp", "login", MCP_NAME], {
    cwd: ROOT, stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  if (login.exitCode !== 0) process.exit(login.exitCode);
  console.log("\nAuthorized. Confirm the whole path with `bun run eval check`.");
}
