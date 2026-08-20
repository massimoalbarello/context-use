import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_STORIES, configOrigin, describeSelection, type EvalConfig } from "../config.ts";
import { verifyLocomoDataset } from "../data/locomo-v1/dataset.ts";
import { LOCOMO_DATASET, LOCOMO_DATASET_PATH } from "../data/locomo-v1/manifest.ts";
import { verifyLongMemEvalDataset } from "../data/longmemeval-v1/dataset.ts";
import { LONGMEMEVAL_DATASET, LONGMEMEVAL_DATASET_PATH } from "../data/longmemeval-v1/manifest.ts";
import { steveJobsV1 } from "../data/steve-jobs-v1/suite.ts";
import {
  EVAL_URL,
  MCP_NAME,
  MCP_URL,
  executable,
  harnessLabel,
  runAgentSession,
  type EvalHarness,
} from "../runner/agent.ts";
import { corpusDirectory, corpusIsUnchanged, diffCorpus } from "../runner/corpus/integrity.ts";
import { loadCorpus, windowRecords } from "../runner/corpus/records.ts";
import { EVAL_RESULTS_ROOT } from "../runner/results.ts";
import { style } from "../runner/terminal.ts";
import { knowledgeTemplateSourceDirectory } from "../knowledge-template.ts";

/**
 * Proves that the configured harness can actually run the configured evaluation.
 *
 * Everything here answers one question a configuration file cannot answer on its own: the
 * file says Claude Code and a model, but only a session proves the CLI is installed and
 * signed in, that the MCP authorization completed, that the model id is one the CLI
 * accepts, and that a tool call reaches this repository's knowledge base. A run that fails
 * an hour in because the OAuth flow was never finished is the failure this replaces.
 */

type Outcome = "ok" | "warn" | "fail";

type Check = { outcome: Outcome; label: string; detail: string; remedy?: string };

const MARK: Record<Outcome, string> = {
  ok: style.green("✓"),
  warn: style.yellow("!"),
  fail: style.red("✗"),
};

function print(check: Check): void {
  console.log(`${MARK[check.outcome]} ${check.label.padEnd(22)} ${check.detail}`);
  if (check.remedy) console.log(`  ${style.dim(`→ ${check.remedy}`)}`);
}

function version(binary: string, args: string[]): string {
  const child = Bun.spawnSync([binary, ...args], { stdout: "pipe", stderr: "pipe" });
  return child.stdout.toString().trim().split("\n")[0] ?? "";
}

function checkBinary(harness: EvalHarness): Check {
  let binary: string;
  try {
    binary = executable(harness.provider);
  } catch (error) {
    return {
      outcome: "fail",
      label: "CLI",
      detail: (error as Error).message,
      remedy: harness.provider === "claude"
        ? "Install Claude Code: https://claude.com/claude-code"
        : "Install the Codex CLI, or open the ChatGPT app once so it ships one.",
    };
  }
  return {
    outcome: "ok",
    label: "CLI",
    detail: `${version(binary, ["--version"]) || harness.provider} · ${style.dim(binary)}`,
  };
}

function checkKnowledgeTemplate(config: EvalConfig): Check {
  const directory = knowledgeTemplateSourceDirectory(config.knowledgeTemplate);
  const required = ["AGENTS.md", "directories.json", "pages.json"];
  const missing = required.filter((file) => !existsSync(join(directory, file)));
  return missing.length === 0
    ? {
      outcome: "ok",
      label: "Knowledge template",
      detail: `${config.knowledgeTemplate} · ${directory}`,
    }
    : {
      outcome: "fail",
      label: "Knowledge template",
      detail: `${config.knowledgeTemplate} is missing ${missing.join(", ")}`,
      remedy: `Restore ${directory}`,
    };
}

function checkSignIn(harness: EvalHarness): Check {
  const binary = executable(harness.provider);
  if (harness.provider === "claude") {
    const status = Bun.spawnSync([binary, "auth", "status"], { stdout: "pipe", stderr: "pipe" });
    const text = status.stdout.toString();
    if (status.exitCode !== 0 || !text.includes('"loggedIn": true')) {
      return {
        outcome: "fail",
        label: "Signed in",
        detail: "Claude Code is not signed in.",
        remedy: "claude auth login",
      };
    }
    const account = JSON.parse(text) as { email?: string; authMethod?: string; subscriptionType?: string };
    return {
      outcome: "ok",
      label: "Signed in",
      detail: [account.email, account.authMethod, account.subscriptionType].filter(Boolean).join(" · "),
    };
  }
  const status = Bun.spawnSync([binary, "login", "status"], { stdout: "pipe", stderr: "pipe" });
  if (status.exitCode !== 0) {
    return {
      outcome: "fail",
      label: "Signed in",
      detail: status.stdout.toString().trim() || "Codex is not signed in.",
      remedy: "codex login",
    };
  }
  return { outcome: "ok", label: "Signed in", detail: status.stdout.toString().trim() || "signed in" };
}

/**
 * Whether the local stack is serving the MCP at all. An unauthenticated request is enough:
 * a refused connection means the stack is down, and any HTTP answer means it is up.
 */
async function checkStack(): Promise<Check> {
  try {
    const response = await fetch(MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      signal: AbortSignal.timeout(5000),
    });
    return {
      outcome: "ok",
      label: "Local stack",
      detail: `${MCP_URL} answered ${response.status}${
        response.status === 401 ? style.dim(" (unauthenticated, as expected)") : ""}`,
    };
  } catch (error) {
    return {
      outcome: "fail",
      label: "Local stack",
      detail: `${EVAL_URL} is not answering — ${(error as Error).message}`,
      remedy: "bun run local up",
    };
  }
}

/** What the selected evaluation would actually feed the agent. */
async function checkSelection(config: EvalConfig): Promise<Check> {
  const selection = config.eval;
  if (selection.command === "story" || selection.command === "journey") {
    const stories = selection.command === "journey" ? steveJobsV1.journey : steveJobsV1.stories;
    if (selection.command === "journey" || selection.story === ALL_STORIES) {
      return { outcome: "ok", label: "Stories", detail: `${stories.length} from ${steveJobsV1.id}` };
    }
    return steveJobsV1.stories.some((story) => story.id === selection.story)
      ? { outcome: "ok", label: "Story", detail: `${selection.story} is in ${steveJobsV1.id}` }
      : {
        outcome: "fail",
        label: "Story",
        detail: `${steveJobsV1.id} has no story called ${selection.story}.`,
        remedy: "bun run eval story:list",
      };
  }

  if (selection.command === "locomo") {
    // Same as LongMemEval: the dataset is fetched rather than vendored, so its presence is
    // the one thing a run cannot start without.
    return await verifyLocomoDataset()
      ? {
        outcome: "ok",
        label: "Dataset",
        detail: `locomo10.json matches the pinned size and SHA-256 · ${LOCOMO_DATASET.license}`,
      }
      : {
        outcome: "fail",
        label: "Dataset",
        detail: `${LOCOMO_DATASET_PATH} is missing or does not match the pinned dataset.`,
        remedy: "bun run eval locomo:fetch",
      };
  }

  if (selection.command === "longmem") {
    // The dataset is fetched rather than vendored, so its presence is the one thing a
    // LongMemEval run cannot start without.
    return await verifyLongMemEvalDataset()
      ? {
        outcome: "ok",
        label: "Dataset",
        detail: `${LONGMEMEVAL_DATASET.file} matches the pinned size and SHA-256`,
      }
      : {
        outcome: "fail",
        label: "Dataset",
        detail: `${LONGMEMEVAL_DATASET_PATH} is missing or does not match the pinned dataset.`,
        remedy: "bun run eval longmem:fetch",
      };
  }

  const { corpus, window, batches } = selection;
  if (!corpusIsUnchanged(diffCorpus(corpus))) {
    return {
      outcome: "fail",
      label: "Corpus",
      detail: `The vendored ${corpus} corpus differs from its lockfile, so scores would not compare.`,
      remedy: `bun run eval corpus:verify --corpus ${corpus}`,
    };
  }
  try {
    // Loading it is also how a window this corpus does not have is caught, which is the
    // one way a selection can be well-formed and still unrunnable.
    const records = windowRecords(loadCorpus(corpusDirectory(corpus)), window);
    const all = [...new Set(records.map((record) => record.batch))];
    const selected = all.slice(0, batches ?? all.length);
    const served = records.filter((record) => selected.includes(record.batch)).length;
    return {
      outcome: "ok",
      label: "Corpus",
      detail: `${corpus} matches its lockfile · this run serves ${served} records over ${
        selected.length} batch${selected.length === 1 ? "" : "es"}`,
    };
  } catch (error) {
    return {
      outcome: "fail",
      label: "Corpus",
      detail: (error as Error).message,
      remedy: `Set eval.window in ${configOrigin(config).split(", then ").at(-1)} to one this corpus has.`,
    };
  }
}

/**
 * Names no tool on purpose. An earlier version asked for `list_directories` by name and
 * started reporting a broken setup the day that tool was renamed, which is a property of
 * the prompt rather than of the setup it was meant to check.
 */
const PROBE_PROMPT = `Using the ${MCP_NAME} MCP server, look at the root of the knowledge `
  + "base and reply with exactly one line: OK followed by the number of top-level "
  + "directories you find. Read only — do not write anything.";

type ProbeReading = {
  model?: string;
  mcpStatus?: string;
  calls: { tool: string; failed: boolean }[];
};

/**
 * What one session's own transcript says about the harness that ran it.
 *
 * Claude Code announces the model it resolved and the state of each MCP server before the
 * first token, which is the only place the difference between "configured" and "in use"
 * is visible — an alias resolves to a dated model id there, and an unfinished OAuth flow
 * shows as `needs-auth` rather than as a tool that quietly never gets called.
 */
export function readClaudeProbe(transcript: string): ProbeReading {
  const reading: ProbeReading = { calls: [] };
  const pending = new Map<string, string>();
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    let event: {
      type?: string;
      subtype?: string;
      model?: string;
      mcp_servers?: { name?: string; status?: string }[];
      message?: { content?: { type?: string; id?: string; name?: string; tool_use_id?: string; is_error?: boolean }[] };
    };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }
    if (event.type === "system" && event.subtype === "init") {
      if (event.model) reading.model = event.model;
      const server = event.mcp_servers?.find((entry) => entry.name === MCP_NAME);
      if (server?.status) reading.mcpStatus = server.status;
    }
    for (const block of event.message?.content ?? []) {
      if (block.type === "tool_use" && block.id && block.name?.startsWith(`mcp__${MCP_NAME}__`)) {
        pending.set(block.id, block.name.slice(`mcp__${MCP_NAME}__`.length));
      }
      if (block.type === "tool_result" && block.tool_use_id) {
        const tool = pending.get(block.tool_use_id);
        if (tool) reading.calls.push({ tool, failed: Boolean(block.is_error) });
      }
    }
  }
  return reading;
}

export function readCodexProbe(transcript: string): ProbeReading {
  const reading: ProbeReading = { calls: [] };
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        item?: { type?: string; tool?: string; status?: string };
      };
      if (event.type === "item.completed" && event.item?.type === "mcp_tool_call" && event.item.tool) {
        reading.calls.push({ tool: event.item.tool, failed: event.item.status === "failed" });
      }
    } catch {
      continue;
    }
  }
  return reading;
}

async function probe(harness: EvalHarness): Promise<Check[]> {
  const directory = join(EVAL_RESULTS_ROOT, "checks", new Date().toISOString().replaceAll(":", "-"));
  mkdirSync(directory, { recursive: true });
  const id = "setup-probe";
  try {
    await runAgentSession({ harness, id, prompt: PROBE_PROMPT, runDirectory: directory });
  } catch (error) {
    return [{
      outcome: "fail",
      label: "Agent session",
      detail: (error as Error).message.split("\n")[0] ?? "the session failed",
      remedy: `Full output: ${directory}`,
    }];
  }

  const transcript = readFileSync(join(directory, `${id}-${harness.provider}.jsonl`), "utf8");
  const reading = harness.provider === "claude" ? readClaudeProbe(transcript) : readCodexProbe(transcript);
  const checks: Check[] = [];

  if (harness.provider === "claude") {
    checks.push(reading.model
      // The configured id and the one the CLI resolved are both reported: an alias such as
      // `opus` silently becomes a dated model, and a run is only comparable to another run
      // of the same one.
      ? {
        outcome: "ok",
        label: "Model in use",
        detail: `${reading.model}${
          harness.model && harness.model !== reading.model ? style.dim(` (configured as ${harness.model})`) : ""}`,
      }
      : { outcome: "warn", label: "Model in use", detail: "the session reported no model" });

    const status = reading.mcpStatus ?? "unknown";
    checks.push(status === "connected"
      ? { outcome: "ok", label: "MCP", detail: `${MCP_NAME} connected` }
      : {
        outcome: "fail",
        label: "MCP",
        detail: `${MCP_NAME} reported ${status}`,
        remedy: status === "needs-auth"
          ? "bun run eval connect claude — the browser will ask for this stack's owner passkey."
          : "bun run eval connect claude",
      });
  }

  const succeeded = reading.calls.filter((call) => !call.failed);
  checks.push(succeeded.length
    ? {
      outcome: "ok",
      label: "Knowledge base",
      detail: `${[...new Set(succeeded.map((call) => call.tool))].join(", ")} returned through the MCP`,
    }
    : {
      outcome: "fail",
      label: "Knowledge base",
      detail: reading.calls.length
        ? `every one of the ${reading.calls.length} tool call(s) failed`
        : "the agent reached the knowledge base with no tool call at all",
      remedy: `Full output: ${directory}`,
    });
  return checks;
}

export async function checkSetup(config: EvalConfig, options: { probe: boolean }): Promise<void> {
  console.log(style.heading("\nConfigured run"));
  console.log(`  ${style.dim("Harness:")} ${harnessLabel(config.harness)}`);
  console.log(`  ${style.dim("Template:")} ${config.knowledgeTemplate}`);
  console.log(`  ${style.dim("Eval:   ")} ${describeSelection(config.eval)}`);
  console.log(`  ${style.dim("From:   ")} ${configOrigin(config)}`);

  console.log(style.heading("\nChecks"));
  const checks: Check[] = [checkKnowledgeTemplate(config), await checkSelection(config)];
  const binary = checkBinary(config.harness);
  checks.push(binary);
  if (binary.outcome === "ok") checks.push(checkSignIn(config.harness));
  const stack = await checkStack();
  checks.push(stack);
  for (const check of checks) print(check);

  // A probe would only report the same failure twice, and would report it after a minute
  // of waiting for a CLI that cannot reach anything.
  const blocked = checks.some((check) => check.outcome === "fail");
  if (options.probe && !blocked) {
    console.log(style.dim("\nRunning one live session against the MCP…"));
    for (const check of await probe(config.harness)) {
      checks.push(check);
      print(check);
    }
  } else if (options.probe) {
    console.log(style.dim("\nSkipping the live session: fix the failures above first."));
  }

  const failed = checks.filter((check) => check.outcome === "fail").length;
  if (failed) {
    console.error(style.red(`\n✗ ${failed} check(s) failed. bun run eval run would not measure anything yet.`));
    process.exit(1);
  }
  console.log(style.green(`\n✓ Ready · ${style.blue("bun run eval run")} would ${describeSelection(config.eval)}`));
}
