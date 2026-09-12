import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ReadableStreamDefaultReader } from 'node:stream/web';
import type { BunFile, Subprocess } from 'bun';
import { z } from 'zod';
import { MAX_FACES_PER_IMAGE } from '#models/faces/model.ts';
import { type AnalyzedFace, FaceAnalysisError, type FaceAnalyzer } from './analyzer.ts';
import { prepareFaceModels } from './model-files.ts';
import { LOCAL_FACE_MODEL } from './models.ts';

const MAX_RESPONSE_CHARACTERS = 2_000_000;
const MAX_IMAGE_BYTES = 20_971_520;
const MAX_CROP_BYTES = 262_144;
const BOX_EDGE_TOLERANCE = 1.000001;
const OWNER_EXECUTABLE_MODE = 0o700;
const MAX_DECODED_PIXELS = 16_000_000;
const FACE_ENGINE_FOLDER = 'face-engine';
const NativeFaceSchema = z.object({
  box: z
    .tuple([
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().positive().max(1),
      z.number().positive().max(1),
    ])
    .refine(
      ([x, y, width, height]) =>
        x + width <= BOX_EDGE_TOLERANCE && y + height <= BOX_EDGE_TOLERANCE,
    ),
  score: z.number().min(0).max(1),
  embedding: z.array(z.number().finite()).length(LOCAL_FACE_MODEL.dimensions),
});
const NativeResultSchema = z.object({ faces: z.array(NativeFaceSchema).max(MAX_FACES_PER_IMAGE) });

type NativeProcess = Subprocess<'pipe', 'pipe', 'inherit'>;

/** An inference-only child per image; release its model memory before the next upload. */
export class LocalFaceAnalyzer implements FaceAnalyzer {
  readonly model = LOCAL_FACE_MODEL;
  private readonly directory: string;
  private child: NativeProcess | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private buffered = '';
  private busy = false;
  private modelPaths: string[] | null = null;

  constructor({ dataFolder }: { dataFolder: string }) {
    this.directory = join(dataFolder, 'runtime', 'face-analysis');
  }

  async analyze({
    ownerId,
    image,
    signal,
  }: Parameters<FaceAnalyzer['analyze']>[0]): Promise<AnalyzedFace[]> {
    if (this.busy) {
      throw new FaceAnalysisError(
        'Face analysis is busy. Retry this image when the current analysis finishes.',
      );
    }
    if (image.size > MAX_IMAGE_BYTES) {
      throw new FaceAnalysisError(
        'Face analysis supports images up to 20 MB. The original asset is saved.',
      );
    }
    this.busy = true;
    let workspace: string | undefined;
    const abort = () => this.child?.kill();
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      await this.start(signal);
      signal.throwIfAborted();
      const ownerFolder = join(
        this.directory,
        new Bun.CryptoHasher('sha256').update(ownerId).digest('hex'),
      );
      await mkdir(ownerFolder, { recursive: true, mode: 0o700 });
      workspace = await mkdtemp(join(ownerFolder, 'request-'));
      const imagePath = join(workspace, 'image');
      await Bun.write(imagePath, image);
      this.child!.stdin.write(`${JSON.stringify({ image: imagePath, crops: workspace })}\n`);
      await this.child!.stdin.flush();
      const value: unknown = JSON.parse(await this.line());
      if (typeof value === 'object' && value !== null && 'error' in value) {
        throw new FaceAnalysisError(
          'Image could not be analyzed. It may be damaged or exceed the 16-megapixel limit.',
        );
      }
      const { faces } = NativeResultSchema.parse(value);
      const result: AnalyzedFace[] = [];
      for (const [index, face] of faces.entries()) {
        const file = Bun.file(join(workspace, `${index}.jpg`));
        if (file.size === 0 || file.size > MAX_CROP_BYTES) {
          throw new FaceAnalysisError('Face analyzer returned an invalid crop.');
        }
        result.push({
          box: face.box,
          detectionScore: face.score,
          embedding: face.embedding,
          crop: new Blob([await file.bytes()], { type: 'image/jpeg' }),
        });
      }
      return result;
    } catch (error) {
      await this.stop();
      if (signal.aborted) {
        throw new FaceAnalysisError(
          'Face analysis timed out. The original asset is saved; you can retry it.',
        );
      }
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
      await this.stop();
      if (workspace) {
        await rm(workspace, { recursive: true, force: true });
      }
      this.busy = false;
    }
  }

  async close(): Promise<void> {
    await this.stop();
  }

  private async start(signal: AbortSignal): Promise<void> {
    if (this.child && this.child.exitCode === null) {
      return;
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.modelPaths ??= await prepareFaceModels({
      directory: join(this.directory, 'models'),
      signal,
    });
    const [detector, recognizer] = this.modelPaths;
    const binary = await this.binary();
    signal.throwIfAborted();
    // Model verification and saved uploads leave temporary byte buffers. Reclaim them
    // before loading native weights so both runtimes fit on small instances.
    Bun.gc(true);
    this.child = Bun.spawn([binary, detector!, recognizer!], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'inherit',
      env: {
        ...process.env,
        OPENCV_IO_MAX_IMAGE_PIXELS: String(MAX_DECODED_PIXELS),
        OPENCV_LOG_LEVEL: 'ERROR',
      },
    });
    if (process.platform === 'linux') {
      // Prefer losing this disposable child over the app if the instance runs out of memory.
      // Some hosts restrict procfs writes; normal bounds still apply there.
      await Bun.write(`/proc/${this.child.pid}/oom_score_adj`, '1000').catch(() => undefined);
    }
    this.reader = this.child.stdout.pipeThrough(new TextDecoderStream()).getReader();
    this.buffered = '';
    const ready: unknown = JSON.parse(await this.line());
    if (!ready || typeof ready !== 'object' || !('ready' in ready) || ready.ready !== true) {
      throw new FaceAnalysisError('Face analyzer did not become ready.');
    }
  }

  private async binary(): Promise<string> {
    if (!Bun.isStandaloneExecutable) {
      const sourceBinary = resolve(
        import.meta.dir,
        '../../../.cache/face-engine-host/face-analyzer',
      );
      if (!(await Bun.file(sourceBinary).exists())) {
        throw new FaceAnalysisError(
          'Face analyzer is not built. Run bun --filter @repo/backend build:faces:local, then retry.',
        );
      }
      return sourceBinary;
    }
    const embedded = (Bun.embeddedFiles as readonly BunFile[]).find(
      (file) => file.name === `${FACE_ENGINE_FOLDER}/face-analyzer`,
    );
    if (!embedded) {
      throw new FaceAnalysisError('The application does not contain its face analyzer.');
    }
    const bytes = await embedded.bytes();
    const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const destination = join(this.directory, `analyzer-${hash}`);
    const installed = Bun.file(destination);
    if (
      !(await installed.exists()) ||
      installed.size !== bytes.byteLength ||
      new Bun.CryptoHasher('sha256').update(await installed.bytes()).digest('hex') !== hash
    ) {
      await Bun.write(destination, bytes);
    }
    await chmod(destination, OWNER_EXECUTABLE_MODE);
    return destination;
  }

  private async line(): Promise<string> {
    while (!this.buffered.includes('\n')) {
      const next = await this.reader!.read();
      if (next.done) {
        throw new FaceAnalysisError('Face analyzer stopped unexpectedly. Retry the image.');
      }
      this.buffered += next.value;
      if (this.buffered.length > MAX_RESPONSE_CHARACTERS) {
        throw new FaceAnalysisError('Face analyzer response exceeds its size limit.');
      }
    }
    const end = this.buffered.indexOf('\n');
    const line = this.buffered.slice(0, end);
    this.buffered = this.buffered.slice(end + 1);
    return line;
  }

  private async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child) {
      child.kill();
      await child.exited;
    }
    const reader = this.reader;
    this.reader = null;
    await reader?.cancel().catch(() => undefined);
    this.buffered = '';
  }
}
