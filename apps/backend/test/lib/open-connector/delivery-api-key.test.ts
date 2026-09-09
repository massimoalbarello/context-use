import { expect, test } from 'bun:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadOpenConnectorDeliveryApiKey,
  openConnectorDeliveryApiKeyFileName,
} from '#lib/open-connector/delivery-api-key.ts';

const PRIVATE_FILE_MODE = 0o600;
const FILE_MODE_MASK = 0o777;
const GENERATED_DELIVERY_API_KEY_BYTES = 32;
const CONCURRENT_FIRST_LOADS = 8;

async function withDataFolder(run: (dataFolder: string) => Promise<void>): Promise<void> {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-open-connector-secret-'));
  try {
    await run(dataFolder);
  } finally {
    await rm(dataFolder, { recursive: true, force: true });
  }
}

test('an environment delivery API key overrides durable key storage', async () => {
  await withDataFolder(async (dataFolder) => {
    const loaded = await loadOpenConnectorDeliveryApiKey({
      dataFolder,
      integrationId: 'github-sync',
      environmentValue: 'operator-managed-delivery-key',
    });

    expect(loaded).toEqual({
      value: 'operator-managed-delivery-key',
      source: { kind: 'environment' },
    });
    await expect(
      Bun.file(join(dataFolder, openConnectorDeliveryApiKeyFileName('github-sync'))).exists(),
    ).resolves.toBe(false);
  });
});

test('a generated delivery API key is private and stable per integration', async () => {
  await withDataFolder(async (dataFolder) => {
    const generated = await loadOpenConnectorDeliveryApiKey({
      dataFolder,
      integrationId: 'github-sync',
      environmentValue: undefined,
    });
    const loaded = await loadOpenConnectorDeliveryApiKey({
      dataFolder,
      integrationId: 'github-sync',
      environmentValue: undefined,
    });
    const other = await loadOpenConnectorDeliveryApiKey({
      dataFolder,
      integrationId: 'linear-sync',
      environmentValue: undefined,
    });
    const path = join(dataFolder, openConnectorDeliveryApiKeyFileName('github-sync'));

    expect(generated.source).toEqual({ kind: 'generated-file', path });
    expect(Buffer.from(generated.value, 'base64url')).toHaveLength(
      GENERATED_DELIVERY_API_KEY_BYTES,
    );
    expect(loaded).toEqual({ value: generated.value, source: { kind: 'stored-file', path } });
    expect(other.value).not.toBe(generated.value);
    expect((await stat(path)).mode & FILE_MODE_MASK).toBe(PRIVATE_FILE_MODE);
  });
});

test('concurrent first loads converge on one atomically created delivery API key', async () => {
  await withDataFolder(async (dataFolder) => {
    const loaded = await Promise.all(
      Array.from({ length: CONCURRENT_FIRST_LOADS }, () =>
        loadOpenConnectorDeliveryApiKey({
          dataFolder,
          integrationId: 'github-sync',
          environmentValue: undefined,
        }),
      ),
    );

    expect(new Set(loaded.map(({ value }) => value))).toHaveLength(1);
    expect(loaded.filter(({ source }) => source.kind === 'generated-file')).toHaveLength(1);
  });
});

test('an empty stored delivery API key fails instead of silently changing service identity', async () => {
  await withDataFolder(async (dataFolder) => {
    const path = join(dataFolder, openConnectorDeliveryApiKeyFileName('github-sync'));
    await writeFile(path, '');

    await expect(
      loadOpenConnectorDeliveryApiKey({
        dataFolder,
        integrationId: 'github-sync',
        environmentValue: undefined,
      }),
    ).rejects.toThrow(`Open-connector delivery API key file is empty: ${path}`);
  });
});
