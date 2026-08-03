import { randomUUID } from "node:crypto";

import { readAgentSyncConfig, readAgentSyncToken } from "./config.ts";
import { acquireAgentSyncRunLock } from "./lock.ts";
import { pushAgentConversations, type AgentSyncRemoteDependencies } from "./remote.ts";
import { AgentSyncState } from "./state.ts";
import { captureTranscript, defaultSourceRoots, discoverTranscriptFiles, type SourceRoot } from "./transcripts.ts";
import type { AgentSyncConfig } from "./types.ts";

const MAX_BATCH_RECORDS = 100;
const MAX_BATCH_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS_PER_RUN = 1_000;

export type AgentSyncRunResult = {
  state: "completed" | "already-running";
  discovered: number;
  captured: number;
  changed: number;
  scanErrors: number;
  accepted: number;
  pending: number;
};

export type AgentSyncRunDependencies = AgentSyncRemoteDependencies & {
  config?: AgentSyncConfig;
  token?: string;
  roots?: SourceRoot[];
  statePath?: string;
  now?: () => number;
  batchId?: () => string;
  lockPath?: string;
};

export async function runAgentSync(dependencies: AgentSyncRunDependencies = {}): Promise<AgentSyncRunResult> {
  const config = dependencies.config ?? await readAgentSyncConfig();
  const token = dependencies.token ?? await readAgentSyncToken();
  if (!config || !token) throw new Error("Agent sync is not installed; run `context-use agent-sync install`");
  const lock = await acquireAgentSyncRunLock(dependencies.lockPath);
  if (!lock) {
    return { state: "already-running", discovered: 0, captured: 0, changed: 0, scanErrors: 0, accepted: 0, pending: 0 };
  }
  const now = dependencies.now ?? Date.now;
  const state = await AgentSyncState.open(dependencies.statePath);
  try {
    let scanErrors = 0;
    const files = await discoverTranscriptFiles(dependencies.roots ?? defaultSourceRoots(), () => {
      scanErrors += 1;
    });
    let captured = 0;
    let changed = 0;
    for (const file of files) {
      if (!state.shouldCapture(file, now())) continue;
      try {
        const outcome = state.stage(await captureTranscript(file), now());
        captured += 1;
        if (outcome === "inserted" || outcome === "updated") changed += 1;
      } catch (error) {
        state.recordScanError(file, error, now());
        scanErrors += 1;
      }
    }
    state.markScanCompleted(now());

    let accepted = 0;
    let remainingBudget = MAX_RECORDS_PER_RUN;
    while (remainingBudget > 0) {
      const pending = state.pending(Math.min(MAX_BATCH_RECORDS, remainingBudget), now());
      if (pending.length === 0) break;
      const batch = fitBatch(pending);
      try {
        await pushAgentConversations(config.webhookUrl, token, {
          type: "agent.conversation.upsert",
          connectionId: config.connectionId,
          batchId: dependencies.batchId?.() ?? randomUUID(),
          sentAt: new Date(now()).toISOString(),
          records: batch.map((item) => item.record),
        }, dependencies);
        state.markAccepted(batch, now());
        accepted += batch.length;
        remainingBudget -= batch.length;
      } catch (error) {
        state.markFailed(batch, error);
        throw error;
      }
    }
    const summary = state.summary();
    return {
      state: "completed",
      discovered: files.length,
      captured,
      changed,
      scanErrors,
      accepted,
      pending: summary.pending,
    };
  } finally {
    state.close();
    await lock.release();
  }
}

function fitBatch<T extends { record: unknown }>(pending: T[]): T[] {
  const batch: T[] = [];
  let bytes = 0;
  for (const item of pending) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item.record), "utf8");
    if (batch.length > 0 && bytes + itemBytes > MAX_BATCH_BYTES) break;
    if (itemBytes > MAX_BATCH_BYTES) throw new Error("A conversation exceeds the agent-sync batch limit");
    batch.push(item);
    bytes += itemBytes;
  }
  return batch;
}
