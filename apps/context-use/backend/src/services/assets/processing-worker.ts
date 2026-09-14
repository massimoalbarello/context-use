import { createLogger } from '#backend/lib/logger.ts';

const POLL_MS = 2000;
const logger = createLogger('face-processing');

/** Serializes background polling; the face service owns inference, cancellation, and durable work. */
export class FaceProcessingWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private requested = false;
  private closed = false;

  /** runNext returns true after making progress, or false when processing must wait. */
  constructor(private readonly runNext: () => Promise<boolean>) {}

  start() {
    if (this.closed) {
      throw new Error('A closed face processing worker cannot be restarted.');
    }
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.wake(), POLL_MS);
    this.timer.unref();
    this.wake();
  }

  wake() {
    if (!this.timer) {
      return;
    }
    this.requested = true;
    if (this.running) {
      return;
    }
    this.running = this.drain()
      .catch(() => {
        logger.error('Image processing paused; pending work will be retried.');
      })
      .finally(() => {
        this.running = null;
      });
  }

  private async drain() {
    do {
      this.requested = false;
      while (this.timer && (await this.runNext())) {
        /* Each iteration reads one persisted asset. */
      }
    } while (this.timer && this.requested);
  }

  async close() {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = null;
    await this.running;
  }
}
