import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PluginConfig } from './contract';
import type { LearningAttachment, LearningEvidence } from './learning-evidence';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const BATCH_CHARS = 48_000;
export const attachmentDirectory = (connectionId: string) =>
  `learning-${encodeURIComponent(connectionId)}-attachments`;
export const DREAM_INTERVAL_MS = 21_600_000;
export const learningDatabase = (connectionId: string) =>
  `learning-${encodeURIComponent(connectionId)}.sqlite`;

export type LearningJob = {
  id: string;
  kind: 'learn' | 'dream';
  sessionKey: string;
  source: string;
  through: number;
  evidence: string;
  runId: string | null;
  acknowledged: number;
  startedAt: number;
};

/** A temporary delivery queue, not an alternative personal memory store. */
export class LearningStore {
  private readonly db: DatabaseSync;

  constructor(input: { directory: string; config: PluginConfig; connectionId: string }) {
    mkdirSync(input.directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    const path = join(input.directory, learningDatabase(input.connectionId));
    this.db = new DatabaseSync(path);
    chmodSync(path, PRIVATE_FILE_MODE);
    this.db.exec(`
      PRAGMA busy_timeout = 1000;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS owner (config TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence (
        id INTEGER PRIMARY KEY, source TEXT NOT NULL, fingerprint TEXT NOT NULL,
        text TEXT, capturedAt INTEGER NOT NULL, UNIQUE(source, fingerprint)
      );
      CREATE TABLE IF NOT EXISTS job (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        id TEXT NOT NULL, kind TEXT NOT NULL, sessionKey TEXT NOT NULL,
        source TEXT NOT NULL, through INTEGER NOT NULL, evidence TEXT NOT NULL,
        runId TEXT, acknowledged INTEGER NOT NULL DEFAULT 0, startedAt INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS retries (source TEXT PRIMARY KEY, retryAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attachments (
        source TEXT NOT NULL, key TEXT NOT NULL, evidenceId INTEGER NOT NULL,
        data TEXT, asset TEXT, uploadName TEXT, PRIMARY KEY (source, key)
      );
      CREATE TABLE IF NOT EXISTS dreaming (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1), through INTEGER NOT NULL,
        completedAt INTEGER NOT NULL
      );
    `);
    const owner = JSON.stringify({ ...input.config, connectionId: input.connectionId });
    this.db.prepare('INSERT INTO owner SELECT ? WHERE NOT EXISTS (SELECT 1 FROM owner)').run(owner);
    if (
      (this.db.prepare('SELECT config FROM owner').get() as { config: string }).config !== owner
    ) {
      this.db.close();
      throw new Error('Context Use learning queue belongs to a different connection.');
    }
  }

  capture(input: { source: string; evidence: LearningEvidence[]; now: number }): void {
    this.transaction(() => {
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO evidence(source, fingerprint, text, capturedAt) VALUES (?, ?, ?, ?)',
      );
      for (const item of input.evidence) {
        insert.run(input.source, item.key, item.text, input.now);
        if (item.attachment) {
          this.db
            .prepare(`INSERT OR IGNORE INTO attachments(source, key, evidenceId, data)
            SELECT source, fingerprint, id, ? FROM evidence WHERE source = ? AND fingerprint = ?`)
            .run(JSON.stringify(item.attachment), input.source, item.key);
        }
      }
    });
  }

  current(): LearningJob | undefined {
    return this.db.prepare('SELECT * FROM job').get() as LearningJob | undefined;
  }

  next(input: { agentId: string; now: number }): LearningJob | undefined {
    return this.transaction(() => {
      const existing = this.current();
      if (existing) {
        return existing;
      }
      const first = this.db
        .prepare(
          'SELECT e.source FROM evidence e LEFT JOIN retries r ON r.source = e.source WHERE e.text IS NOT NULL AND (r.retryAt IS NULL OR r.retryAt <= ?) ORDER BY e.id LIMIT 1',
        )
        .get(input.now) as { source: string } | undefined;
      let { through, evidence } = this.batch(first?.source);
      if (!first) {
        through = this.dreamThrough(input.now);
        if (!through) {
          return undefined;
        }
      }
      const id = randomUUID();
      this.db
        .prepare(
          'INSERT INTO job(singleton, id, kind, sessionKey, source, through, evidence) VALUES (1, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          first ? 'learn' : 'dream',
          `agent:${input.agentId}:subagent:context-use-learning:${id}`,
          first?.source ?? '',
          through,
          evidence,
        );
      return this.current();
    });
  }

  private batch(source?: string): { through: number; evidence: string } {
    const rows = source
      ? (this.db
          .prepare(
            'SELECT id, text, capturedAt FROM evidence WHERE source = ? AND text IS NOT NULL ORDER BY id LIMIT 100',
          )
          .all(source) as { id: number; text: string; capturedAt: number }[])
      : [];
    let through = 0;
    let evidence = '';
    for (const row of rows) {
      if (evidence.length + row.text.length > BATCH_CHARS) {
        break;
      }
      evidence += `${JSON.stringify({ observedAt: new Date(row.capturedAt).toISOString(), message: JSON.parse(row.text) })}\n`;
      through = row.id;
    }
    return { through, evidence };
  }

  private dreamThrough(now: number): number {
    if (
      this.status().pending ||
      this.db.prepare("SELECT 1 FROM retries WHERE source = '' AND retryAt > ?").get(now)
    ) {
      return 0;
    }
    const progress = this.db
      .prepare('SELECT MAX(id) AS through, MIN(capturedAt) AS since FROM evidence')
      .get() as { through: number | null; since: number | null };
    const dream = this.db.prepare('SELECT through, completedAt FROM dreaming').get() as
      | { through: number; completedAt: number }
      | undefined;
    if (
      !progress.through ||
      progress.through <= (dream?.through ?? 0) ||
      now - (dream?.completedAt ?? progress.since ?? now) < DREAM_INTERVAL_MS
    ) {
      return 0;
    }
    return progress.through;
  }

  started(input: { id: string; runId: string; now: number }): void {
    this.db
      .prepare('UPDATE job SET runId = ?, startedAt = ? WHERE id = ?')
      .run(input.runId, input.now, input.id);
  }

  attachments(
    job: LearningJob,
  ): { key: string; attachment: LearningAttachment; asset: string | null }[] {
    const rows = this.db
      .prepare(
        'SELECT key, data, asset FROM attachments WHERE source = ? AND evidenceId <= ? AND data IS NOT NULL ORDER BY evidenceId',
      )
      .all(job.source, job.through) as { key: string; data: string; asset: string | null }[];
    return rows.map((row) => ({
      key: row.key,
      attachment: JSON.parse(row.data),
      asset: row.asset,
    }));
  }

  private attachmentSource(input: { jobId: string; key: string }): string {
    const job = this.current();
    if (
      !job ||
      job.id !== input.jobId ||
      !this.attachments(job).some((item) => item.key === input.key)
    ) {
      throw new Error('This attachment is not part of the active learning job.');
    }
    return job.source;
  }

  prepareAttachmentUpload(input: { jobId: string; key: string; name: string }): string {
    const source = this.attachmentSource(input);
    this.db
      .prepare(
        'UPDATE attachments SET uploadName = COALESCE(uploadName, ?) WHERE source = ? AND key = ?',
      )
      .run(input.name, source, input.key);
    return (
      this.db
        .prepare('SELECT uploadName FROM attachments WHERE source = ? AND key = ?')
        .get(source, input.key) as { uploadName: string }
    ).uploadName;
  }

  clearAttachmentUploadName(input: { jobId: string; key: string }): void {
    const source = this.attachmentSource(input);
    this.db
      .prepare('UPDATE attachments SET uploadName = NULL WHERE source = ? AND key = ?')
      .run(source, input.key);
  }

  savedAttachment(input: { jobId: string; key: string; asset: string }): void {
    const source = this.attachmentSource(input);
    this.db
      .prepare('UPDATE attachments SET asset = ? WHERE source = ? AND key = ?')
      .run(input.asset, source, input.key);
  }

  acknowledge(input: { sessionKey: string; omittedAttachments?: string[] }): void {
    const { sessionKey, omittedAttachments = [] } = input;
    const job = this.current();
    if (
      job?.sessionKey === sessionKey &&
      this.attachments(job).some((item) => !item.asset && !omittedAttachments.includes(item.key))
    ) {
      throw new Error(
        'Save every attachment or explicitly exclude it for a retention reason before finishing. Failed uploads must be retried.',
      );
    }
    const result = this.db
      .prepare('UPDATE job SET acknowledged = 1 WHERE sessionKey = ?')
      .run(sessionKey);
    if (!result.changes) {
      throw new Error('This learning run is no longer active.');
    }
  }

  retry(input: { id: string; at: number }): void {
    this.transaction(() => {
      const job = this.current();
      if (!job || job.id !== input.id) {
        return;
      }
      this.db.prepare('INSERT OR REPLACE INTO retries VALUES (?, ?)').run(job.source, input.at);
      this.db.prepare('DELETE FROM job WHERE id = ?').run(input.id);
    });
  }

  finish(input: { id: string; now: number }): void {
    this.transaction(() => {
      const job = this.current();
      if (!job || job.id !== input.id || !job.acknowledged) {
        throw new Error('Learning must be acknowledged before removing its evidence.');
      }
      if (job.kind === 'learn') {
        this.db
          .prepare('UPDATE evidence SET text = NULL WHERE source = ? AND id <= ?')
          .run(job.source, job.through);
        this.db
          .prepare('UPDATE attachments SET data = NULL WHERE source = ? AND evidenceId <= ?')
          .run(job.source, job.through);
      } else {
        this.db
          .prepare('INSERT OR REPLACE INTO dreaming VALUES (1, ?, ?)')
          .run(job.through, input.now);
      }
      this.db.prepare('DELETE FROM retries WHERE source = ?').run(job.source);
      this.db.prepare('DELETE FROM job WHERE id = ?').run(job.id);
    });
  }

  status() {
    return {
      pending: (
        this.db.prepare('SELECT COUNT(*) AS count FROM evidence WHERE text IS NOT NULL').get() as {
          count: number;
        }
      ).count,
      running: Boolean(this.current()?.runId),
      retryAt:
        (this.db.prepare('SELECT MIN(retryAt) AS at FROM retries').get() as { at: number | null })
          .at ?? undefined,
    };
  }

  close(): void {
    this.db.close();
  }

  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
