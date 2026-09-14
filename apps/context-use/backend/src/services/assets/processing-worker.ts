import { createLogger } from '#backend/lib/logger.ts';

const POLL_MS = 2000;
const logger = createLogger('face-processing');

/** One worker owns the local inference engine; persisted assets are its source of pending work. */
export class FaceProcessingWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private requested = false;

  constructor(private readonly runNext: () => Promise<boolean>) {}

  start() {
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
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = null;
    await this.running;
  }
}
