import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { atomicSecureWrite } from "./files.ts";
import { agentSyncSourcesPath } from "./paths.ts";
import { defaultSourceRoots } from "./transcripts.ts";
import type { AgentSource, SourceRoot } from "./types.ts";

const pathsSchema = z.array(z.string().trim().min(1).max(4_096)).max(20);
const sourceConfigSchema = z.object({
  schemaVersion: z.literal(1),
  codex: pathsSchema.optional(),
  claudeCode: pathsSchema.optional(),
  claudeWorkspace: pathsSchema.optional(),
}).strict();

type SourceConfig = z.infer<typeof sourceConfigSchema>;

const DEFAULT_SOURCE_CONFIG: SourceConfig = {
  schemaVersion: 1,
  codex: ["~/.codex/sessions", "~/.codex/archived_sessions"],
  claudeCode: ["~/.claude/projects"],
  claudeWorkspace: ["~/.codex/claude-cowork-transcript-imports"],
};

const SOURCE_FIELDS = [
  { source: "codex", key: "codex" },
  { source: "claude-code", key: "claudeCode" },
  { source: "claude-cowork", key: "claudeWorkspace" },
] as const satisfies ReadonlyArray<{ source: AgentSource; key: keyof SourceConfig }>;

export type AgentSyncSourceOverrides = {
  codex?: string | undefined;
  claudeCode?: string | undefined;
  claudeWorkspace?: string | undefined;
};

type SourceConfigOptions = {
  path?: string;
  home?: string;
  baseDirectory?: string;
};

export async function readAgentSyncSourceRoots(options: SourceConfigOptions = {}): Promise<SourceRoot[]> {
  const path = options.path ?? agentSyncSourcesPath;
  const home = options.home ?? homedir();
  const baseDirectory = options.baseDirectory ?? dirname(path);
  return effectiveSourceRoots(await readSourceConfig(path), home, baseDirectory);
}

export async function ensureAgentSyncSourceConfig(
  overrides: AgentSyncSourceOverrides = {},
  options: SourceConfigOptions = {},
): Promise<SourceRoot[]> {
  const path = options.path ?? agentSyncSourcesPath;
  const home = options.home ?? homedir();
  const baseDirectory = options.baseDirectory ?? dirname(path);
  const config = await readSourceConfig(path) ?? { ...DEFAULT_SOURCE_CONFIG };
  if (overrides.codex !== undefined) config.codex = [overrides.codex];
  if (overrides.claudeCode !== undefined) config.claudeCode = [overrides.claudeCode];
  if (overrides.claudeWorkspace !== undefined) config.claudeWorkspace = [overrides.claudeWorkspace];
  const validated = sourceConfigSchema.parse(config);
  await atomicSecureWrite(path, `${JSON.stringify(validated, null, 2)}\n`);
  return effectiveSourceRoots(validated, home, baseDirectory);
}

async function readSourceConfig(path: string): Promise<SourceConfig | null> {
  try {
    return sourceConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function effectiveSourceRoots(config: SourceConfig | null, home: string, baseDirectory: string): SourceRoot[] {
  const defaults = defaultSourceRoots(home);
  return SOURCE_FIELDS.flatMap(({ source, key }) => {
    const configured = config?.[key];
    if (configured === undefined) return defaults.filter((candidate) => candidate.source === source);
    return configured.map((path) => ({ source, root: absoluteSourceRoot(path, home, baseDirectory) }));
  });
}

function absoluteSourceRoot(input: string, home: string, baseDirectory: string): string {
  if (input === "~") return home;
  if (input.startsWith("~/")) return resolve(home, input.slice(2));
  if (input.startsWith("~")) throw new Error("Agent-sync paths support ~ but not another user's home shortcut");
  return resolve(baseDirectory, input);
}
