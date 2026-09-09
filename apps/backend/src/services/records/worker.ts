import { createLogger } from '#lib/logger.ts';
import { type RecordIngestionJob, recordPresentation } from '#models/records/model.ts';
import type {
  RecordJobProjection,
  RecordsRepositoryContract,
} from '#repositories/records/repository.ts';

const DEFAULT_LEASE_MILLISECONDS = 30_000;
const DEFAULT_POLL_MILLISECONDS = 1_000;
const RETRY_BASE_MILLISECONDS = 1_000;
const MILLISECONDS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const RETRY_MAX_MILLISECONDS = MINUTES_PER_HOUR * MILLISECONDS_PER_MINUTE;
const MAX_STORED_ERROR_LENGTH = 1_000;

export type RecordIngestionTickResult =
  | 'idle'
  | 'completed'
  | 'superseded'
  | 'lost_lease'
  | 'retried';

function delay({
  milliseconds,
  signal,
}: {
  milliseconds: number;
  signal: AbortSignal;
}): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function retryDelay(attemptCount: number): number {
  const exponent = Math.max(attemptCount - 1, 0);
  return Math.min(RETRY_BASE_MILLISECONDS * 2 ** exponent, RETRY_MAX_MILLISECONDS);
}

function storedError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  return (message || 'Unknown record ingestion failure').slice(0, MAX_STORED_ERROR_LENGTH);
}

function projectionFor(job: RecordIngestionJob): RecordJobProjection | null {
  if (job.operation === 'deleted') {
    return null;
  }
  if (!job.content) {
    throw new Error('Record ingestion content is missing');
  }
  return {
    label: recordPresentation(job.content.body).title,
    body: job.content.body,
  };
}

export class RecordIngestionWorker {
  private readonly records: RecordsRepositoryContract;
  private readonly now: () => Date;
  private readonly leaseMilliseconds: number;
  private readonly pollMilliseconds: number;
  private readonly leaseToken: () => string;
  private readonly stopWhenDrained: boolean;
  private readonly logger = createLogger('RecordIngestionWorker');
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;

  constructor({
    records,
    now = () => new Date(),
    leaseMilliseconds = DEFAULT_LEASE_MILLISECONDS,
    pollMilliseconds = DEFAULT_POLL_MILLISECONDS,
    leaseToken = () => Bun.randomUUIDv7(),
    stopWhenDrained = false,
  }: {
    records: RecordsRepositoryContract;
    now?: () => Date;
    leaseMilliseconds?: number;
    pollMilliseconds?: number;
    leaseToken?: () => string;
    stopWhenDrained?: boolean;
  }) {
    this.records = records;
    this.now = now;
    this.leaseMilliseconds = leaseMilliseconds;
    this.pollMilliseconds = pollMilliseconds;
    this.leaseToken = leaseToken;
    this.stopWhenDrained = stopWhenDrained;
  }

  async tick(): Promise<RecordIngestionTickResult> {
    const startedAt = this.now();
    const job = await this.records.claimJob({
      now: startedAt.toISOString(),
      leaseToken: this.leaseToken(),
      leaseExpiresAt: new Date(startedAt.getTime() + this.leaseMilliseconds).toISOString(),
    });
    if (!job) {
      return 'idle';
    }

    try {
      return await this.records.completeJob({
        job,
        projection: projectionFor(job),
        completedAt: this.now().toISOString(),
      });
    } catch (error) {
      const failedAt = this.now();
      const retried = await this.records.retryJob({
        job,
        availableAt: new Date(failedAt.getTime() + retryDelay(job.attemptCount)).toISOString(),
        error: storedError(error),
        updatedAt: failedAt.toISOString(),
      });
      return retried ? 'retried' : 'lost_lease';
    }
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.controller = new AbortController();
    this.running = this.run(this.controller.signal);
  }

  waitUntilStopped(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  async stop(): Promise<void> {
    const running = this.running;
    if (!running) {
      return;
    }
    this.controller?.abort();
    await running;
    this.controller = null;
    this.running = null;
  }

  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const result = await this.tick();
        if (result !== 'idle') {
          continue;
        }
        if (this.stopWhenDrained && !(await this.records.hasUnfinishedJobs())) {
          return;
        }
      } catch (error) {
        this.logger.error('Record ingestion tick failed', error);
      }
      await delay({ milliseconds: this.pollMilliseconds, signal });
    }
  }
}
