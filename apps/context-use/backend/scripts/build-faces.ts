import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { clearLine, cursorTo } from 'node:readline';
import { faceEngineDirectory } from './shared/build-assets';
import { BACKEND_BUILD_TARGET } from './shared/build-target';

const backend = resolve(import.meta.dir, '..');
const root = resolve(backend, '../../..');
const SPINNER_FRAMES = ['|', '/', '-', '\\'];
const SPINNER_INTERVAL_MS = 100;
const STATUS_INTERVAL_MS = 15_000;
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const FAILURE_LOG_BYTES = 8192;
const FAILURE_LOG_LINES = 12;

async function buildFaceAnalyzer({ host }: { host: boolean }) {
  const destination = faceEngineDirectory({ host });
  const build = join(root, '.cache', host ? 'face-build-host' : 'face-build-linux');
  await mkdir(build, { recursive: true });
  const logPath = join(build, 'build.log');
  await writeFile(logPath, '');
  const log = Bun.file(logPath).writer();
  const started = performance.now();
  function elapsed() {
    const seconds = Math.floor((performance.now() - started) / MILLISECONDS_PER_SECOND);
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
    return minutes ? `${minutes}m ${seconds % SECONDS_PER_MINUTE}s` : `${seconds}s`;
  }
  console.log(`Preparing face recognition for ${host ? 'this computer' : 'Linux deployment'}.`);
  console.log(
    'This builds the engine that finds people in images. The first build can take several minutes; later builds reuse cached work.',
  );

  async function run({ command, label }: { command: string[]; label: string }) {
    log.write(`\n> ${command.join(' ')}\n`);
    if (!Bun.which(command[0]!)) {
      throw new Error(
        `${command[0]} is required to build face recognition. ${host ? 'Install CMake 3.24+ and a C++ toolchain (on macOS: brew install cmake and xcode-select --install).' : 'Install and start Docker.'}`,
      );
    }
    const child = Bun.spawn(command, {
      cwd: root,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    const interactive = Boolean(process.stdout.isTTY);
    let frame = 0;
    function progress() {
      const message = `${interactive ? SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length] : '…'} ${label} · ${elapsed()} elapsed`;
      if (interactive) {
        clearLine(process.stdout, 0);
        cursorTo(process.stdout, 0);
        process.stdout.write(message);
      } else {
        console.log(message);
      }
    }
    progress();
    const timer = setInterval(progress, interactive ? SPINNER_INTERVAL_MS : STATUS_INTERVAL_MS);
    async function capture(stream: ReadableStream<Uint8Array>) {
      for await (const chunk of stream) {
        log.write(chunk);
      }
    }
    try {
      const [exitCode] = await Promise.all([
        child.exited,
        capture(child.stdout),
        capture(child.stderr),
      ]);
      if (exitCode !== 0) {
        throw new Error(`${label} failed (exit ${exitCode}).`);
      }
    } finally {
      clearInterval(timer);
      if (interactive) {
        clearLine(process.stdout, 0);
        cursorTo(process.stdout, 0);
      }
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  }

  try {
    if (host) {
      await run({
        label: 'Checking build configuration',
        command: [
          'cmake',
          '-S',
          'apps/context-use/backend/native/faces',
          '-B',
          build,
          '-DCMAKE_BUILD_TYPE=Release',
        ],
      });
      await run({
        label: 'Building face recognition engine',
        command: ['cmake', '--build', build, '--target', 'face-analyzer', '-j2'],
      });
      await mkdir(destination, { recursive: true });
      const temporary = join(destination, `face-analyzer-${Bun.randomUUIDv7()}`);
      try {
        await cp(join(build, 'runtime/face-analyzer'), temporary);
        await rename(temporary, join(destination, 'face-analyzer'));
      } finally {
        await rm(temporary, { force: true });
      }
    } else {
      await run({
        label: 'Building face recognition engine',
        command: [
          'docker',
          'buildx',
          'build',
          '--platform',
          'linux/amd64',
          '--progress=plain',
          '-f',
          'apps/context-use/backend/native/faces/Dockerfile',
          '--output',
          `type=local,dest=${destination}`,
          '.',
        ],
      });
    }
    console.log(`Face recognition ready · ${elapsed()}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log.flush();
    const file = Bun.file(logPath);
    const tail = await file.slice(Math.max(0, file.size - FAILURE_LOG_BYTES)).text();
    if (tail.trim()) {
      console.error(tail.trim().split(/\r?\n/).slice(-FAILURE_LOG_LINES).join('\n'));
    }
    log.write(`\n${message}\n`);
    throw new Error(`${message}\nFull build output: ${logPath}`);
  } finally {
    await log.end();
  }
}

if (import.meta.main) {
  try {
    const host = Bun.argv.includes('--host') || !BACKEND_BUILD_TARGET;
    if (!host && !BACKEND_BUILD_TARGET!.startsWith('bun-linux-x64')) {
      throw new Error('The bundled face analyzer supports Linux x64 or BUILD_TARGET=host.');
    }
    await buildFaceAnalyzer({ host });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
