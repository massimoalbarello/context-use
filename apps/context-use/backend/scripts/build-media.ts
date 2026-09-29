import { cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { mediaEngineDirectory } from './shared/build-assets';
import { BACKEND_BUILD_TARGET } from './shared/build-target';

const backend = resolve(import.meta.dir, '..');
const root = resolve(backend, '../../..');
const host = Bun.argv.includes('--host') || !BACKEND_BUILD_TARGET;
const destination = mediaEngineDirectory({ host });
const build = join(root, '.cache', host ? 'media-build-host' : 'media-build-linux');

async function run(command: string[]) {
  const child = Bun.spawn(command, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    if ((await child.exited) !== 0) {
      throw new Error(`Media preview build failed: ${command[0]}`);
    }
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}

if (host) {
  await run(['cmake', '-S', 'apps/context-use/backend/native/media', '-B', build]);
  await run(['cmake', '--build', build, '--target', 'media-preview', '-j2']);
  await mkdir(destination, { recursive: true });
  await cp(join(build, 'runtime/bin/ffmpeg'), join(destination, 'ffmpeg'));
} else {
  if (!BACKEND_BUILD_TARGET!.startsWith('bun-linux-x64')) {
    throw new Error('Media previews support Linux x64 or BUILD_TARGET=host.');
  }
  await run([
    'docker',
    'buildx',
    'build',
    '--platform',
    'linux/amd64',
    '--progress=plain',
    '-f',
    'apps/context-use/backend/native/media/Dockerfile',
    '--output',
    `type=local,dest=${destination}`,
    '.',
  ]);
}

await cp(join(root, 'LICENSE'), join(destination, 'LICENSE'));
