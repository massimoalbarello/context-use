import { cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const backend = resolve(import.meta.dir, '..');
const root = resolve(backend, '../..');
const host = Bun.argv.includes('--host');
const destination = join(backend, '.cache', host ? 'face-engine-host' : 'face-engine-linux');

async function run(command: string[]) {
  const child = Bun.spawn(command, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
  if ((await child.exited) !== 0) {
    throw new Error('Native face analyzer build failed.');
  }
}

if (host) {
  const build = join(root, '.cache/face-build-host');
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
  await cp(join(build, 'runtime/face-analyzer'), join(destination, 'face-analyzer'));
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
