import { expect, test } from 'bun:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAuthSecret } from '#lib/auth/auth-secret.ts';

const AUTH_SECRET_FILE_NAME = '.better-auth-secret';
const PRIVATE_FILE_MODE = 0o600;

async function withDataFolder(run: (dataFolder: string) => Promise<void>): Promise<void> {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-auth-secret-'));
  try {
    await run(dataFolder);
  } finally {
    await rm(dataFolder, { recursive: true, force: true });
  }
}

test('an environment secret overrides durable secret storage', async () => {
  await withDataFolder(async (dataFolder) => {
    const loaded = await loadAuthSecret({ dataFolder, environmentSecret: 'operator-secret' });

    expect(loaded).toEqual({ value: 'operator-secret', source: { kind: 'environment' } });
    await expect(Bun.file(join(dataFolder, AUTH_SECRET_FILE_NAME)).exists()).resolves.toBe(false);
  });
});

test('a generated secret is private and stable across restarts', async () => {
  await withDataFolder(async (dataFolder) => {
    const generated = await loadAuthSecret({ dataFolder, environmentSecret: undefined });
    const loaded = await loadAuthSecret({ dataFolder, environmentSecret: undefined });
    const path = join(dataFolder, AUTH_SECRET_FILE_NAME);

    expect(generated.source).toEqual({ kind: 'generated-file', path });
    expect(generated.value).toMatch(/^[a-f0-9]{64}$/);
    expect(loaded).toEqual({ value: generated.value, source: { kind: 'stored-file', path } });
    expect((await stat(path)).mode & 0o777).toBe(PRIVATE_FILE_MODE);
  });
});

test('an empty stored secret fails instead of silently replacing instance identity', async () => {
  await withDataFolder(async (dataFolder) => {
    const path = join(dataFolder, AUTH_SECRET_FILE_NAME);
    await writeFile(path, '');

    await expect(loadAuthSecret({ dataFolder, environmentSecret: undefined })).rejects.toThrow(
      `Auth secret file is empty: ${path}`,
    );
  });
});
