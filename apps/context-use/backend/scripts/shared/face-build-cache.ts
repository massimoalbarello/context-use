import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { faceEngineDirectory } from './build-assets';

type FaceBuildCache = { key: string; directory: string };

export async function linuxFaceBuildCache(): Promise<FaceBuildCache> {
  const backend = resolve(import.meta.dir, '../..');
  const sources = await Array.fromAsync(
    new Bun.Glob('native/faces/**/*').scan({ cwd: backend, onlyFiles: true }),
  );
  const inputs = [
    ...sources,
    'scripts/build-faces.ts',
    'scripts/shared/build-assets.ts',
    'scripts/shared/build-target.ts',
    'scripts/shared/face-build-cache.ts',
  ].sort();
  const hash = createHash('sha256');
  for (const path of inputs) {
    hash
      .update(path)
      .update('\0')
      .update(await readFile(join(backend, path)))
      .update('\0');
  }
  return {
    key: `face-engine-linux-amd64-${hash.digest('hex')}`,
    directory: faceEngineDirectory({ host: false }),
  };
}

async function artifactFingerprint({ key, directory }: FaceBuildCache): Promise<string> {
  const binary = join(directory, 'face-analyzer');
  await access(binary, constants.X_OK);
  const digest = createHash('sha256')
    .update(await readFile(binary))
    .digest('hex');
  return `${key}\n${digest}\n`;
}

export async function hasCachedFaceBuild(cache: FaceBuildCache): Promise<boolean> {
  try {
    return (
      (await readFile(join(cache.directory, 'build-fingerprint'), 'utf8')) ===
      (await artifactFingerprint(cache))
    );
  } catch {
    return false;
  }
}

export async function recordFaceBuild(cache: FaceBuildCache): Promise<void> {
  const fingerprint = await artifactFingerprint(cache);
  const temporary = join(cache.directory, `build-fingerprint-${Bun.randomUUIDv7()}`);
  try {
    await writeFile(temporary, fingerprint);
    await rename(temporary, join(cache.directory, 'build-fingerprint'));
  } finally {
    await rm(temporary, { force: true });
  }
}
