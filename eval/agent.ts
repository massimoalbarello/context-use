import { existsSync } from "node:fs";
import { join } from "node:path";
import { stackUrl } from "../scripts/local-stack.ts";

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

const WRITE_TOOL_LABELS: Record<string, string> = {
  create_directory: "Created directory",
  create_page: "Created page",
  update_page: "Updated page",
  archive_page: "Archived page",
};

export function printCodexProgress(line: string): void {
  try {
    const event = JSON.parse(line) as {
      type?: string;
      item?: { type?: string; tool?: string; arguments?: { path?: string } };
      error?: { message?: string };
    };
    if (event.type === "item.completed"
      && event.item?.type === "mcp_tool_call"
      && event.item.tool
      && WRITE_TOOL_LABELS[event.item.tool]) {
      console.log(`  ✓ ${WRITE_TOOL_LABELS[event.item.tool]} · ${event.item.arguments?.path ?? "(unknown path)"}`);
    } else if (event.type?.includes("failed")) {
      console.error(`  Agent error: ${event.error?.message ?? line}`);
    }
  } catch {
    // Preserve non-JSON output in the log without flooding the terminal.
  }
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
    capture(child.stdout, printCodexProgress),
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
    "--allowedTools", `mcp__${MCP_NAME}__*`, "--output-format", "stream-json",
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
