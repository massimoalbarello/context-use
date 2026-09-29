import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { join, resolve } from 'node:path';
import type { BunFile } from 'bun';
import { imageSize } from 'image-size';

const MAX_EDGE = 1280;
const MAX_PIXELS = 16_000_000;
const MAX_ALLOCATION_BYTES = 67_108_864;
const MAX_PREVIEW_BYTES = 4_194_304;
const TIMEOUT_MS = 20_000;
const EXECUTABLE_MODE = 0o700;

export interface MediaPreviewProcessor {
  prepare(): Promise<void>;
  generate(input: { blob: Blob; signal: AbortSignal }): Promise<{
    blob: Blob;
    width: number;
    height: number;
  }>;
}

export class LocalMediaPreviewProcessor implements MediaPreviewProcessor {
  private binaryPath: string | null = null;
  constructor(private readonly directory: string) {}

  async prepare() {
    if (this.binaryPath) {
      return;
    }
    if (!Bun.isStandaloneExecutable) {
      const path = resolve(import.meta.dir, '../../../.cache/media-engine-host/ffmpeg');
      if (!(await Bun.file(path).exists())) {
        throw new Error(
          'Build media previews with bun --filter @repo/context-use build:media:host.',
        );
      }
      this.binaryPath = path;
      return;
    }
    const embedded = (Bun.embeddedFiles as readonly BunFile[]).find(
      (file) => file.name === 'media-engine/ffmpeg',
    );
    if (!embedded) {
      throw new Error('The application does not contain its media preview processor.');
    }
    const bytes = await embedded.bytes();
    const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const path = join(this.directory, `ffmpeg-${hash}`);
    const installed = Bun.file(path);
    if (
      !(await installed.exists()) ||
      new Bun.CryptoHasher('sha256').update(await installed.bytes()).digest('hex') !== hash
    ) {
      await Bun.write(path, bytes);
    }
    const license = (Bun.embeddedFiles as readonly BunFile[]).find(
      (file) => file.name === 'media-engine/LICENSE',
    );
    if (license) {
      await Bun.write(join(this.directory, 'LICENSE'), license);
    }
    await chmod(path, EXECUTABLE_MODE);
    this.binaryPath = path;
  }

  async generate({ blob, signal }: { blob: Blob; signal: AbortSignal }) {
    await this.prepare();
    signal.throwIfAborted();
    // nibrun's /tmp is memory-backed; stage large originals on the data volume.
    await mkdir(this.directory, { recursive: true });
    const directory = await mkdtemp(join(this.directory, 'work-'));
    try {
      const input = join(directory, 'input');
      const output = join(directory, 'preview.webp');
      await Bun.write(input, blob);
      signal.throwIfAborted();
      const child = Bun.spawn(
        [
          this.binaryPath!,
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-max_alloc',
          String(MAX_ALLOCATION_BYTES),
          '-threads',
          '1',
          '-max_pixels',
          String(MAX_PIXELS),
          '-protocol_whitelist',
          'file',
          '-format_whitelist',
          'image2,jpeg_pipe,png_pipe,webp_pipe,bmp_pipe,tiff_pipe,gif,mov,matroska,webm,avi',
          '-i',
          input,
          '-map',
          '0:v:0',
          '-an',
          '-sn',
          '-dn',
          '-frames:v',
          '1',
          '-filter_threads',
          '1',
          '-vf',
          `scale=w='min(${MAX_EDGE},iw)':h='min(${MAX_EDGE},ih)':force_original_aspect_ratio=decrease:reset_sar=1`,
          '-c:v',
          'libwebp',
          '-quality',
          '80',
          '-threads',
          '1',
          '-fs',
          String(MAX_PREVIEW_BYTES),
          output,
        ],
        { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
      );
      try {
        setPriority(child.pid, constants.priority.PRIORITY_LOW);
      } catch {
        // Processing limits still apply when the host cannot adjust scheduling.
      }
      const stop = () => child.kill('SIGKILL');
      const timeout = setTimeout(stop, TIMEOUT_MS);
      signal.addEventListener('abort', stop, { once: true });
      try {
        if (process.platform === 'linux') {
          // Prefer losing disposable preview work over the app on a memory-constrained host.
          await Bun.write(`/proc/${child.pid}/oom_score_adj`, '1000').catch(() => undefined);
        }
        const exitCode = await child.exited;
        signal.throwIfAborted();
        const file = Bun.file(output);
        if (exitCode !== 0 || !(await file.exists()) || file.size > MAX_PREVIEW_BYTES) {
          throw new Error('Media preview could not be generated.');
        }
        const bytes = await file.bytes();
        const { width, height } = imageSize(bytes);
        if (width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE) {
          throw new Error('Media preview dimensions exceed the limit.');
        }
        return { blob: new Blob([bytes], { type: 'image/webp' }), width, height };
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', stop);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
