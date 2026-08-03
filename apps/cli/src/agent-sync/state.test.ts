import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PipelineRecord } from "../../../../nango-integrations/pipeline-record.ts";
import { AgentSyncState } from "./state.ts";
import type { CapturedConversation } from "./types.ts";

test("SQLite outbox keeps the newest payload, rejects stale paths, and reconciles accepted records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "context-use-agent-sync-state-"));
  const state = await AgentSyncState.open(join(directory, "state.sqlite"));
  try {
    const original = captured(record("one", "2026-08-01T10:00:00.000Z", "first"), "/active.jsonl", 1);
    expect(state.shouldCapture(original.file, 1)).toBe(true);
    expect(state.stage(original, 1)).toBe("inserted");
    expect(state.shouldCapture(original.file, 2)).toBe(false);
    expect(state.pending(100, 2)).toHaveLength(1);

    const sameTimestampEdit = captured(record("one", "2026-08-01T10:00:00.000Z", "edited"), "/active.jsonl", 2);
    expect(state.stage(sameTimestampEdit, 2)).toBe("updated");
    const edited = state.pending(100, 2);
    expect(edited[0]?.record.updated_at).toBe("2026-08-01T10:00:00.001Z");
    expect(edited[0]?.record.body).toBe("edited");

    const staleArchive = captured(record("one", "2026-07-01T10:00:00.000Z", "stale"), "/archive.jsonl", 3);
    expect(state.stage(staleArchive, 3)).toBe("stale");
    expect(state.pending(100, 3)[0]?.record.body).toBe("edited");

    state.markAccepted(edited, 4);
    expect(state.pending(100, 5)).toHaveLength(0);
    expect(state.pending(100, 24 * 60 * 60 * 1_000 + 5)).toHaveLength(1);
    expect(state.summary()).toMatchObject({ trackedFiles: 2, records: 1, pending: 0, scanErrors: 0 });
  } finally {
    state.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("unchanged scan errors back off until the file changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "context-use-agent-sync-error-"));
  const state = await AgentSyncState.open(join(directory, "state.sqlite"));
  try {
    const file = { source: "codex" as const, path: "/bad.jsonl", size: 10, mtimeMs: 20 };
    state.recordScanError(file, new Error("malformed"), 1);
    expect(state.shouldCapture(file, 2)).toBe(false);
    expect(state.shouldCapture({ ...file, size: 11 }, 2)).toBe(true);
    expect(state.summary().scanErrors).toBe(1);
  } finally {
    state.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function record(id: string, updatedAt: string, body: string): PipelineRecord {
  return {
    id,
    created_at: "2026-08-01T09:00:00.000Z",
    updated_at: updatedAt,
    participants: [],
    body,
  };
}

function captured(value: PipelineRecord, path: string, size: number): CapturedConversation {
  return {
    file: { source: "codex", path, size, mtimeMs: size },
    fileHash: String(size).padStart(64, "0"),
    record: value,
  };
}
