import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { agentSyncStatePath } from "./paths.ts";
import { AgentConversationRecordSchema, type AgentConversationRecord } from "./record.ts";
import type { CapturedConversation, TranscriptFile } from "./types.ts";

const REVERIFY_AFTER_MS = 24 * 60 * 60 * 1_000;
const RECONCILE_AFTER_MS = 24 * 60 * 60 * 1_000;

type FileCheckpoint = {
  size_bytes: number;
  mtime_ms: number;
  next_verify_at: number;
};

type StoredPayload = {
  payload_json: string;
};

type PendingRow = {
  id: string;
  payload_json: string;
  payload_hash: string;
};

export type PendingRecord = {
  record: AgentConversationRecord;
  payloadHash: string;
};

export type AgentSyncStateSummary = {
  trackedFiles: number;
  records: number;
  pending: number;
  scanErrors: number;
  lastScanAt: string | null;
  lastAcceptedAt: string | null;
};

export class AgentSyncState implements Disposable {
  private constructor(private readonly database: Database) {}

  static async open(path = agentSyncStatePath): Promise<AgentSyncState> {
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const database = new Database(path, { create: true, strict: true });
    await chmod(path, 0o600);
    database.run("PRAGMA journal_mode = WAL");
    database.run("PRAGMA synchronous = FULL");
    database.run("PRAGMA busy_timeout = 5000");
    database.run(`
      CREATE TABLE IF NOT EXISTS file_checkpoints (
        path TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mtime_ms REAL NOT NULL,
        file_hash TEXT NOT NULL,
        record_id TEXT NOT NULL,
        next_verify_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    database.run(`
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        accepted_hash TEXT,
        accepted_at TEXT,
        next_reconcile_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        updated_at TEXT NOT NULL
      )
    `);
    database.run(`
      CREATE TABLE IF NOT EXISTS scan_errors (
        path TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mtime_ms REAL NOT NULL,
        message TEXT NOT NULL,
        retry_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    database.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    return new AgentSyncState(database);
  }

  [Symbol.dispose](): void {
    this.database.close();
  }

  close(): void {
    this.database.close();
  }

  shouldCapture(file: TranscriptFile, now = Date.now()): boolean {
    const checkpoint = this.database
      .query<FileCheckpoint, [string]>(
        "SELECT size_bytes, mtime_ms, next_verify_at FROM file_checkpoints WHERE path = ?",
      )
      .get(file.path);
    if (checkpoint) {
      return checkpoint.size_bytes !== file.size
        || checkpoint.mtime_ms !== file.mtimeMs
        || checkpoint.next_verify_at <= now;
    }
    const error = this.database
      .query<FileCheckpoint, [string]>(
        "SELECT size_bytes, mtime_ms, retry_at AS next_verify_at FROM scan_errors WHERE path = ?",
      )
      .get(file.path);
    return !error
      || error.size_bytes !== file.size
      || error.mtime_ms !== file.mtimeMs
      || error.next_verify_at <= now;
  }

  stage(captured: CapturedConversation, now = Date.now()): "inserted" | "updated" | "unchanged" | "stale" {
    return this.database.transaction(() => {
      const existing = this.database
        .query<StoredPayload, [string]>("SELECT payload_json FROM records WHERE id = ?")
        .get(captured.record.id);
      let record = captured.record;
      let outcome: "inserted" | "updated" | "unchanged" | "stale" = existing ? "updated" : "inserted";

      if (existing) {
        const stored = AgentConversationRecordSchema.parse(JSON.parse(existing.payload_json));
        const incomingTime = Date.parse(record.updated_at);
        const storedTime = Date.parse(stored.updated_at);
        if (incomingTime < storedTime) {
          outcome = "stale";
          record = stored;
        } else if (sameConversation(record, stored)) {
          outcome = "unchanged";
          record = stored;
        } else if (incomingTime === storedTime) {
          record = { ...record, updated_at: new Date(storedTime + 1).toISOString() };
        }
      }

      const payloadJson = canonicalJson(record);
      const payloadHash = Bun.CryptoHasher.hash("sha256", payloadJson, "hex");
      if (outcome === "inserted" || outcome === "updated") {
        this.database.run(
          `INSERT INTO records (id, payload_json, payload_hash, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             payload_json = excluded.payload_json,
             payload_hash = excluded.payload_hash,
             updated_at = excluded.updated_at,
             attempts = 0,
             last_error = NULL`,
          [record.id, payloadJson, payloadHash, new Date(now).toISOString()],
        );
      }
      this.database.run(
        `INSERT INTO file_checkpoints
           (path, source, size_bytes, mtime_ms, file_hash, record_id, next_verify_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           source = excluded.source,
           size_bytes = excluded.size_bytes,
           mtime_ms = excluded.mtime_ms,
           file_hash = excluded.file_hash,
           record_id = excluded.record_id,
           next_verify_at = excluded.next_verify_at,
           updated_at = excluded.updated_at`,
        [
          captured.file.path,
          captured.file.source,
          captured.file.size,
          captured.file.mtimeMs,
          captured.fileHash,
          record.id,
          now + REVERIFY_AFTER_MS,
          new Date(now).toISOString(),
        ],
      );
      this.database.run("DELETE FROM scan_errors WHERE path = ?", [captured.file.path]);
      return outcome;
    })();
  }

  recordScanError(file: TranscriptFile, error: unknown, now = Date.now()): void {
    const message = error instanceof Error ? error.message : String(error);
    this.database.run(
      `INSERT INTO scan_errors (path, source, size_bytes, mtime_ms, message, retry_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         source = excluded.source,
         size_bytes = excluded.size_bytes,
         mtime_ms = excluded.mtime_ms,
         message = excluded.message,
         retry_at = excluded.retry_at,
         updated_at = excluded.updated_at`,
      [file.path, file.source, file.size, file.mtimeMs, message.slice(0, 2_000), now + REVERIFY_AFTER_MS, new Date(now).toISOString()],
    );
  }

  pending(limit: number, now = Date.now()): PendingRecord[] {
    const rows = this.database
      .query<PendingRow, [number, number]>(
        `SELECT id, payload_json, payload_hash
         FROM records
         WHERE accepted_hash IS NULL
            OR accepted_hash != payload_hash
            OR next_reconcile_at IS NULL
            OR next_reconcile_at <= ?
         ORDER BY CASE WHEN accepted_hash IS NULL OR accepted_hash != payload_hash THEN 0 ELSE 1 END,
                  updated_at,
                  id
         LIMIT ?`,
      )
      .all(now, limit);
    return rows.map((row) => ({
      record: AgentConversationRecordSchema.parse(JSON.parse(row.payload_json)),
      payloadHash: row.payload_hash,
    }));
  }

  markAccepted(records: PendingRecord[], now = Date.now()): void {
    const acceptedAt = new Date(now).toISOString();
    this.database.transaction(() => {
      for (const item of records) {
        this.database.run(
          `UPDATE records
           SET accepted_hash = ?, accepted_at = ?, next_reconcile_at = ?, attempts = 0, last_error = NULL
           WHERE id = ? AND payload_hash = ?`,
          [item.payloadHash, acceptedAt, now + RECONCILE_AFTER_MS, item.record.id, item.payloadHash],
        );
      }
    })();
  }

  markFailed(records: PendingRecord[], error: unknown): void {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
    this.database.transaction(() => {
      for (const item of records) {
        this.database.run(
          "UPDATE records SET attempts = attempts + 1, last_error = ? WHERE id = ? AND payload_hash = ?",
          [message, item.record.id, item.payloadHash],
        );
      }
    })();
  }

  markScanCompleted(now = Date.now()): void {
    this.database.run(
      "INSERT INTO meta (key, value) VALUES ('last_scan_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [new Date(now).toISOString()],
    );
  }

  summary(): AgentSyncStateSummary {
    const scalar = (sql: string): number => this.database.query<{ count: number }, []>(sql).get()?.count ?? 0;
    const value = (key: string): string | null => this.database
      .query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?")
      .get(key)?.value ?? null;
    return {
      trackedFiles: scalar("SELECT count(*) AS count FROM file_checkpoints"),
      records: scalar("SELECT count(*) AS count FROM records"),
      pending: scalar("SELECT count(*) AS count FROM records WHERE accepted_hash IS NULL OR accepted_hash != payload_hash"),
      scanErrors: scalar("SELECT count(*) AS count FROM scan_errors"),
      lastScanAt: value("last_scan_at"),
      lastAcceptedAt: this.database
        .query<{ value: string | null }, []>("SELECT max(accepted_at) AS value FROM records")
        .get()?.value ?? null,
    };
  }
}

function canonicalJson(record: AgentConversationRecord): string {
  return JSON.stringify({
    id: record.id,
    created_at: record.created_at,
    updated_at: record.updated_at,
    participants: record.participants,
    body: record.body,
  });
}

function sameConversation(left: AgentConversationRecord, right: AgentConversationRecord): boolean {
  return left.id === right.id
    && left.created_at === right.created_at
    && left.participants.length === right.participants.length
    && left.participants.every((participant, index) => participant === right.participants[index])
    && left.body === right.body;
}
