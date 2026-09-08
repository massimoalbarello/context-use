import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadOpenConnectorReceiverRuntimeConfig,
  loadOpenConnectorSetupConfig,
  OPEN_CONNECTOR_ENVIRONMENT,
  OPEN_CONNECTOR_MAX_BEARER_TOKEN_BYTES,
} from '#lib/open-connector/config.ts';

async function withDataFolder(run: (dataFolder: string) => Promise<void>): Promise<void> {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-open-connector-config-'));
  try {
    await run(dataFolder);
  } finally {
    await rm(dataFolder, { recursive: true, force: true });
  }
}

function receiverEnvironment(overrides: Record<string, string> = {}) {
  return {
    [OPEN_CONNECTOR_ENVIRONMENT.receiverId]: 'context-use',
    [OPEN_CONNECTOR_ENVIRONMENT.ownerId]: 'context-use-owner',
    ...overrides,
  };
}

function setupEnvironment(overrides: Record<string, string> = {}) {
  return receiverEnvironment({
    [OPEN_CONNECTOR_ENVIRONMENT.baseUrl]: 'http://127.0.0.1:8787',
    [OPEN_CONNECTOR_ENVIRONMENT.adminToken]: 'admin-token',
    [OPEN_CONNECTOR_ENVIRONMENT.callbackUrl]:
      'https://context-use-tunnel.example/api/integrations/open-connector/records',
    [OPEN_CONNECTOR_ENVIRONMENT.receiverToken]: 'receiver-token',
    ...overrides,
  });
}

test('runtime receiver configuration is absent only when no receiver settings are present', async () => {
  await withDataFolder(async (dataFolder) => {
    expect(await loadOpenConnectorReceiverRuntimeConfig({ dataFolder, environment: {} })).toBe(
      undefined,
    );
    await expect(
      loadOpenConnectorReceiverRuntimeConfig({
        dataFolder,
        environment: { [OPEN_CONNECTOR_ENVIRONMENT.receiverToken]: 'partial-token' },
      }),
    ).rejects.toThrow('OPEN_CONNECTOR_RECEIVER_ID is required');
    await expect(
      loadOpenConnectorReceiverRuntimeConfig({
        dataFolder,
        environment: { [OPEN_CONNECTOR_ENVIRONMENT.receiverId]: 'context-use' },
      }),
    ).rejects.toThrow('OPEN_CONNECTOR_OWNER_ID is required');
  });
});

test('runtime and setup configuration resolve the same stable generated receiver token', async () => {
  await withDataFolder(async (dataFolder) => {
    const runtime = await loadOpenConnectorReceiverRuntimeConfig({
      dataFolder,
      environment: receiverEnvironment(),
    });
    const setup = await loadOpenConnectorSetupConfig({
      dataFolder,
      environment: setupEnvironment({ [OPEN_CONNECTOR_ENVIRONMENT.receiverToken]: '' }),
    });
    if (!runtime) {
      throw new Error('Expected receiver runtime configuration');
    }

    expect(runtime).toEqual(
      expect.objectContaining({
        integrationId: 'context-use',
        receiverId: 'context-use',
        ownerId: 'context-use-owner',
      }),
    );
    expect(setup.bearerToken).toBe(runtime.bearerToken);
    expect(runtime.bearerTokenSource.kind).toBe('generated-file');
    expect(setup.bearerTokenSource.kind).toBe('stored-file');
  });
});

test('setup configuration validates receiver identity, URL boundaries, and distinct secrets', async () => {
  await withDataFolder(async (dataFolder) => {
    await expect(
      loadOpenConnectorSetupConfig({
        dataFolder,
        environment: setupEnvironment({
          [OPEN_CONNECTOR_ENVIRONMENT.receiverId]: '/invalid',
        }),
      }),
    ).rejects.toThrow('OPEN_CONNECTOR_RECEIVER_ID must match');
    await expect(
      loadOpenConnectorSetupConfig({
        dataFolder,
        environment: setupEnvironment({
          [OPEN_CONNECTOR_ENVIRONMENT.ownerId]: 'some-auth-user',
        }),
      }),
    ).rejects.toThrow(
      'OPEN_CONNECTOR_OWNER_ID must be context-use-owner, the claimed Context Use owner',
    );
    await expect(
      loadOpenConnectorSetupConfig({
        dataFolder,
        environment: setupEnvironment({
          [OPEN_CONNECTOR_ENVIRONMENT.callbackUrl]:
            'http://context-use.example/api/integrations/open-connector/records',
        }),
      }),
    ).rejects.toThrow('OPEN_CONNECTOR_CALLBACK_URL must use public HTTPS');
    await expect(
      loadOpenConnectorSetupConfig({
        dataFolder,
        environment: setupEnvironment({
          [OPEN_CONNECTOR_ENVIRONMENT.callbackUrl]:
            'https://127.0.0.1/api/integrations/open-connector/records',
        }),
      }),
    ).rejects.toThrow('OPEN_CONNECTOR_CALLBACK_URL must use a public hostname');
    await expect(
      loadOpenConnectorSetupConfig({
        dataFolder,
        environment: setupEnvironment({
          [OPEN_CONNECTOR_ENVIRONMENT.callbackUrl]: 'https://context-use.example/wrong',
        }),
      }),
    ).rejects.toThrow(
      'OPEN_CONNECTOR_CALLBACK_URL must end at /api/integrations/open-connector/records',
    );
    await expect(
      loadOpenConnectorSetupConfig({
        dataFolder,
        environment: setupEnvironment({
          [OPEN_CONNECTOR_ENVIRONMENT.adminToken]: 'same-secret',
          [OPEN_CONNECTOR_ENVIRONMENT.receiverToken]: 'same-secret',
        }),
      }),
    ).rejects.toThrow('must be distinct');
  });
});

test('setup configuration accepts only bounded HTTP-header-safe Bearer tokens', async () => {
  await withDataFolder(async (dataFolder) => {
    for (const [name, value] of [
      [OPEN_CONNECTOR_ENVIRONMENT.adminToken, 'admin token'],
      [OPEN_CONNECTOR_ENVIRONMENT.receiverToken, 'receiver\ttoken'],
      [OPEN_CONNECTOR_ENVIRONMENT.adminToken, 'admin\u0001token'],
      [OPEN_CONNECTOR_ENVIRONMENT.receiverToken, 'receiver\u007ftoken'],
      [OPEN_CONNECTOR_ENVIRONMENT.adminToken, 'admin-🔑'],
      [
        OPEN_CONNECTOR_ENVIRONMENT.adminToken,
        'a'.repeat(OPEN_CONNECTOR_MAX_BEARER_TOKEN_BYTES + 1),
      ],
      [
        OPEN_CONNECTOR_ENVIRONMENT.receiverToken,
        'r'.repeat(OPEN_CONNECTOR_MAX_BEARER_TOKEN_BYTES + 1),
      ],
    ] as const) {
      await expect(
        loadOpenConnectorSetupConfig({
          dataFolder,
          environment: setupEnvironment({ [name]: value }),
        }),
      ).rejects.toThrow('must be a visible ASCII Bearer token');
    }
  });
});

test('a generated receiver token can be reused without presenting its environment variable', async () => {
  await withDataFolder(async (dataFolder) => {
    const runtime = await loadOpenConnectorReceiverRuntimeConfig({
      dataFolder,
      environment: receiverEnvironment(),
    });
    const error = await loadOpenConnectorSetupConfig({
      dataFolder,
      environment: setupEnvironment({
        [OPEN_CONNECTOR_ENVIRONMENT.adminToken]: runtime?.bearerToken ?? '',
        [OPEN_CONNECTOR_ENVIRONMENT.receiverToken]: '',
      }),
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('must be distinct');
    expect((error as Error).message).not.toContain(OPEN_CONNECTOR_ENVIRONMENT.receiverToken);
  });
});

test('setup configuration keeps setup-only credentials out of runtime configuration', async () => {
  await withDataFolder(async (dataFolder) => {
    const environment = setupEnvironment();
    const runtime = await loadOpenConnectorReceiverRuntimeConfig({ dataFolder, environment });
    const setup = await loadOpenConnectorSetupConfig({ dataFolder, environment });

    expect(runtime).not.toHaveProperty('adminToken');
    expect(runtime).not.toHaveProperty('baseUrl');
    expect(runtime).not.toHaveProperty('callbackUrl');
    expect(setup).toEqual(
      expect.objectContaining({
        baseUrl: new URL('http://127.0.0.1:8787'),
        callbackUrl: new URL(
          'https://context-use-tunnel.example/api/integrations/open-connector/records',
        ),
        adminToken: 'admin-token',
        bearerToken: 'receiver-token',
      }),
    );
  });
});
