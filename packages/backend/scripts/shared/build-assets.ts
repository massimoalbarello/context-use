import { join, resolve } from 'node:path';

const backend = resolve(import.meta.dir, '../..');
export const migrationDirectory = join(backend, 'src/db/migrations');

export function faceEngineDirectory({ host }: { host: boolean }) {
  return join(backend, '.cache', host ? 'face-engine-host' : 'face-engine-linux');
}
