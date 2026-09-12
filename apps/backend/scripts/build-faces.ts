import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const backend = resolve(import.meta.dir, '..');
const root = resolve(backend, '../..');

async function buildFaceAnalyzer({ host }: { host: boolean }) {
  const destination = join(backend, '.cache', host ? 'face-engine-host' : 'face-engine-linux');
  const build = join(root, '.cache', host ? 'face-build-host' : 'face-build-linux');
  await mkdir(build, { recursive: true });
  const logPath = join(build, 'build.log');
  const log = Bun.file(logPath).writer();
  console.log(`Preparing face recognition (${host ? 'local' : 'Linux'}) · build log: ${logPath}`);

  async function run(command: string[]) {
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
    async function forward(input: {
      stream: ReadableStream<Uint8Array>;
      output: NodeJS.WriteStream;
    }) {
      for await (const chunk of input.stream) {
        log.write(chunk);
        input.output.write(chunk);
      }
    }
    try {
      const [exitCode] = await Promise.all([
        child.exited,
        forward({ stream: child.stdout, output: process.stdout }),
        forward({ stream: child.stderr, output: process.stderr }),
      ]);
      if (exitCode !== 0) {
        throw new Error(
          `Native face analyzer build failed (exit ${exitCode}): ${command.join(' ')}`,
        );
      }
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  }

  try {
    if (host) {
      // CMake owns incremental rebuilds, including changes to the native sources and configuration.
      await run([
        'cmake',
        '-S',
        'apps/backend/native/faces',
        '-B',
        build,
        '-DCMAKE_BUILD_TYPE=Release',
      ]);
      await run(['cmake', '--build', build, '--target', 'face-analyzer', '-j2']);
      await mkdir(destination, { recursive: true });
      const temporary = join(destination, `face-analyzer-${Bun.randomUUIDv7()}`);
      try {
        await cp(join(build, 'runtime/face-analyzer'), temporary);
        await rename(temporary, join(destination, 'face-analyzer'));
      } finally {
        await rm(temporary, { force: true });
      }
    } else {
      await run([
        'docker',
        'buildx',
        'build',
        '--platform',
        'linux/amd64',
        '-f',
        'apps/backend/native/faces/Dockerfile',
        '--output',
        `type=local,dest=${destination}`,
        '.',
      ]);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.write(`\n${message}\n`);
    throw new Error(`${message}\nFull build output: ${logPath}`);
  } finally {
    await log.end();
  }
}

if (import.meta.main) {
  try {
    await buildFaceAnalyzer({ host: Bun.argv.includes('--host') });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
