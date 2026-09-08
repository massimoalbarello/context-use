import { expect, test } from 'bun:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadOpenConnectorReceiverSecret,
  OPEN_CONNECTOR_RECEIVER_SECRET_FILE_NAME,
} from '#lib/open-connector/receiver-secret.ts';

const PRIVATE_FILE_MODE = 0o600;
const FILE_MODE_MASK = 0o777;
const GENERATED_RECEIVER_SECRET_BYTES = 32;
const CONCURRENT_FIRST_LOADS = 8;

async function withDataFolder(run: (dataFolder: string) => Promise<void>): Promise<void> {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-open-connector-secret-'));
  try {
    await run(dataFolder);
  } finally {
    await rm(dataFolder, { recursive: true, force: true });
  }
}

test('an environment receiver token overrides durable secret storage', async () => {
  await withDataFolder(async (dataFolder) => {
    const loaded = await loadOpenConnectorReceiverSecret({
      dataFolder,
      environmentSecret: 'operator-managed-receiver-token',
    });

    expect(loaded).toEqual({
      value: 'operator-managed-receiver-token',
      source: { kind: 'environment' },
    });
    await expect(
      Bun.file(join(dataFolder, OPEN_CONNECTOR_RECEIVER_SECRET_FILE_NAME)).exists(),
    ).resolves.toBe(false);
  });
});

test('a generated receiver token is private and stable across restarts', async () => {
  await withDataFolder(async (dataFolder) => {
    const generated = await loadOpenConnectorReceiverSecret({
      dataFolder,
      environmentSecret: undefined,
    });
    const loaded = await loadOpenConnectorReceiverSecret({
      dataFolder,
      environmentSecret: undefined,
    });
    const path = join(dataFolder, OPEN_CONNECTOR_RECEIVER_SECRET_FILE_NAME);

    expect(generated.source).toEqual({ kind: 'generated-file', path });
    expect(Buffer.from(generated.value, 'base64url')).toHaveLength(GENERATED_RECEIVER_SECRET_BYTES);
    expect(loaded).toEqual({ value: generated.value, source: { kind: 'stored-file', path } });
    expect((await stat(path)).mode & FILE_MODE_MASK).toBe(PRIVATE_FILE_MODE);
  });
});

test('concurrent first loads converge on the one atomically created receiver token', async () => {
  await withDataFolder(async (dataFolder) => {
    const loaded = await Promise.all(
      Array.from({ length: CONCURRENT_FIRST_LOADS }, () =>
        loadOpenConnectorReceiverSecret({ dataFolder, environmentSecret: undefined }),
      ),
    );

    expect(new Set(loaded.map(({ value }) => value))).toHaveLength(1);
    expect(loaded.filter(({ source }) => source.kind === 'generated-file')).toHaveLength(1);
  });
});

test('an empty stored receiver token fails instead of silently changing receiver identity', async () => {
  await withDataFolder(async (dataFolder) => {
    const path = join(dataFolder, OPEN_CONNECTOR_RECEIVER_SECRET_FILE_NAME);
    await writeFile(path, '');

    await expect(
      loadOpenConnectorReceiverSecret({ dataFolder, environmentSecret: undefined }),
    ).rejects.toThrow(`Open-connector receiver token file is empty: ${path}`);
  });
});
