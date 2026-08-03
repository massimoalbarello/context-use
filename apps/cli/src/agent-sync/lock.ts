import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { agentSyncLockPath } from "./paths.ts";

export type AgentSyncRunLock = { release: () => Promise<void> };

export async function acquireAgentSyncRunLock(path = agentSyncLockPath): Promise<AgentSyncRunLock | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(path, { mode: 0o700 });
      await writeFile(join(path, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), {
        mode: 0o600,
      });
      let released = false;
      return {
        release: async () => {
          if (released) return;
          released = true;
          await rm(path, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await lockOwnerIsAlive(path)) return null;
      await rm(path, { recursive: true, force: true });
    }
  }
  return null;
}

async function lockOwnerIsAlive(path: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(join(path, "owner.json"), "utf8")) as { pid?: unknown };
    if (!Number.isInteger(owner.pid) || (owner.pid as number) <= 0) return false;
    try {
      process.kill(owner.pid as number, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  } catch {
    return false;
  }
}
