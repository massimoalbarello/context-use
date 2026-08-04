import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureAgentSyncSourceConfig, readAgentSyncSourceRoots } from "./source-config.ts";

test("source config is editable, supports multiple roots, and falls back per source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "context-use-agent-sync-sources-"));
  const path = join(directory, "sources.json");
  const options = { path, home: "/Users/tester", baseDirectory: directory };
  try {
    expect(await readAgentSyncSourceRoots(options)).toEqual([
      { source: "codex", root: "/Users/tester/.codex/sessions" },
      { source: "codex", root: "/Users/tester/.codex/archived_sessions" },
      { source: "claude-code", root: "/Users/tester/.claude/projects" },
      { source: "claude-cowork", root: "/Users/tester/Library/Application Support/Claude/local-agent-mode-sessions" },
    ]);

    await ensureAgentSyncSourceConfig({}, options);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      schemaVersion: 1,
      codex: ["~/.codex/sessions", "~/.codex/archived_sessions"],
      claudeCode: ["~/.claude/projects"],
      claudeWorkspace: ["~/Library/Application Support/Claude/local-agent-mode-sessions"],
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    await Bun.write(path, JSON.stringify({
      schemaVersion: 1,
      codex: ["~/custom/sessions", "relative/archive"],
      claudeCode: [],
    }));
    expect(await readAgentSyncSourceRoots(options)).toEqual([
      { source: "codex", root: "/Users/tester/custom/sessions" },
      { source: "codex", root: join(directory, "relative/archive") },
      { source: "claude-cowork", root: "/Users/tester/Library/Application Support/Claude/local-agent-mode-sessions" },
    ]);

    await ensureAgentSyncSourceConfig({ claudeWorkspace: "~/workspace" }, options);
    expect(await readAgentSyncSourceRoots(options)).toEqual([
      { source: "codex", root: "/Users/tester/custom/sessions" },
      { source: "codex", root: join(directory, "relative/archive") },
      { source: "claude-cowork", root: "/Users/tester/workspace" },
    ]);

    await Bun.write(path, JSON.stringify({
      schemaVersion: 1,
      claudeWorkspace: ["~/.codex/claude-cowork-transcript-imports"],
    }));
    expect(await readAgentSyncSourceRoots(options)).toContainEqual({
      source: "claude-cowork",
      root: "/Users/tester/Library/Application Support/Claude/local-agent-mode-sessions",
    });

    await Bun.write(path, JSON.stringify({ schemaVersion: 1, codex: [], unexpected: true }));
    await expect(readAgentSyncSourceRoots(options)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
