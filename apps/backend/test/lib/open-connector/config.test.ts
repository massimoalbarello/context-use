import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadOpenConnectorSetupConfig,
  OPEN_CONNECTOR_ENVIRONMENT,
} from '#lib/open-connector/config.ts';
import { MAX_OPEN_CONNECTOR_DELIVERY_API_KEY_BYTES } from '#models/open-connector/model.ts';

const DELIVERY_API_KEY = 'delivery-api-key-0123456789abcdef';
const SHARED_SECRET = 'same-secret-0123456789abcdefghij';

async function withDataFolder(run: (dataFolder: string) => Promise<void>): Promise<void> {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-open-connector-config-'));
  try {
    await run(dataFolder);
  } finally {
    await rm(dataFolder, { recursive: true, force: true });
  }
}

function setupEnvironment(overrides: Record<string, string> = {}) {
  return {
    [OPEN_CONNECTOR_ENVIRONMENT.baseUrl]: 'http://127.0.0.1:8787',
    [OPEN_CONNECTOR_ENVIRONMENT.adminToken]: 'admin-token',
    [OPEN_CONNECTOR_ENVIRONMENT.integrationId]: 'github-sync',
    [OPEN_CONNECTOR_ENVIRONMENT.callbackUrl]:
      'https://context-use-tunnel.example/api/integrations/open-connector/records',
    [OPEN_CONNECTOR_ENVIRONMENT.deliveryApiKey]: DELIVERY_API_KEY,
    [OPEN_CONNECTOR_ENVIRONMENT.ownerId]: 'context-use-owner',
    ...overrides,
  };
}

test('setup configuration creates stable, distinct delivery API keys per integration', async () => {
  await withDataFolder(async (dataFolder) => {
    const first = await loadOpenConnectorSetupConfig({
      dataFolder,
      environment: setupEnvironment({ [OPEN_CONNECTOR_ENVIRONMENT.deliveryApiKey]: '' }),
    });
    const repeated = await loadOpenConnectorSetupConfig({
      dataFolder,
      environment: setupEnvironment({ [OPEN_CONNECTOR_ENVIRONMENT.deliveryApiKey]: '' }),
    });
    const second = await loadOpenConnectorSetupConfig({
      dataFolder,
      environment: setupEnvironment({
        [OPEN_CONNECTOR_ENVIRONMENT.integrationId]: 'linear-sync',
        [OPEN_CONNECTOR_ENVIRONMENT.deliveryApiKey]: '',
      }),
    });

    expect(first).toEqual(
      expect.objectContaining({
        integrationId: 'github-sync',
        ownerId: 'context-use-owner',
        baseUrl: new URL('http://127.0.0.1:8787'),
        callbackUrl: new URL(
          'https://context-use-tunnel.example/api/integrations/open-connector/records',
        ),
        adminToken: 'admin-token',
      }),
    );
    expect(first.deliveryApiKeySource.kind).toBe('generated-file');
    expect(repeated.deliveryApiKeySource.kind).toBe('stored-file');
    expect(repeated.deliveryApiKey).toBe(first.deliveryApiKey);
    expect(second.deliveryApiKey).not.toBe(first.deliveryApiKey);
  });
});

test('setup configuration validates identity, owner, URL boundaries, and distinct secrets', async () => {
  await withDataFolder(async (dataFolder) => {
    for (const [overrides, message] of [
      [
        { [OPEN_CONNECTOR_ENVIRONMENT.integrationId]: '' },
        'OPEN_CONNECTOR_INTEGRATION_ID is required',
      ],
      [
        { [OPEN_CONNECTOR_ENVIRONMENT.integrationId]: '/invalid' },
        'OPEN_CONNECTOR_INTEGRATION_ID must match',
      ],
      [
        { [OPEN_CONNECTOR_ENVIRONMENT.ownerId]: 'some-auth-user' },
        'OPEN_CONNECTOR_OWNER_ID must be context-use-owner',
      ],
      [
        {
          [OPEN_CONNECTOR_ENVIRONMENT.callbackUrl]:
            'http://context-use.example/api/integrations/open-connector/records',
        },
        'OPEN_CONNECTOR_CALLBACK_URL must use public HTTPS',
      ],
      [
        {
          [OPEN_CONNECTOR_ENVIRONMENT.callbackUrl]:
            'https://127.0.0.1/api/integrations/open-connector/records',
        },
        'OPEN_CONNECTOR_CALLBACK_URL must use a public hostname',
      ],
      [
        { [OPEN_CONNECTOR_ENVIRONMENT.callbackUrl]: 'https://context-use.example/wrong' },
        'OPEN_CONNECTOR_CALLBACK_URL must end at /api/integrations/open-connector/records',
      ],
      [
        {
          [OPEN_CONNECTOR_ENVIRONMENT.adminToken]: SHARED_SECRET,
          [OPEN_CONNECTOR_ENVIRONMENT.deliveryApiKey]: SHARED_SECRET,
        },
        'must be distinct',
      ],
    ] as const) {
      await expect(
        loadOpenConnectorSetupConfig({
          dataFolder,
          environment: setupEnvironment(overrides),
        }),
      ).rejects.toThrow(message);
    }
  });
});

test('setup configuration accepts only bounded HTTP-header-safe credentials', async () => {
  await withDataFolder(async (dataFolder) => {
    for (const [name, value] of [
      [OPEN_CONNECTOR_ENVIRONMENT.adminToken, 'admin token'],
      [OPEN_CONNECTOR_ENVIRONMENT.deliveryApiKey, 'delivery\tkey'],
      [OPEN_CONNECTOR_ENVIRONMENT.adminToken, 'admin\u0001token'],
      [OPEN_CONNECTOR_ENVIRONMENT.deliveryApiKey, 'delivery\u007fkey'],
      [OPEN_CONNECTOR_ENVIRONMENT.adminToken, 'admin-🔑'],
      [
        OPEN_CONNECTOR_ENVIRONMENT.adminToken,
        'a'.repeat(MAX_OPEN_CONNECTOR_DELIVERY_API_KEY_BYTES + 1),
      ],
      [
        OPEN_CONNECTOR_ENVIRONMENT.deliveryApiKey,
        'r'.repeat(MAX_OPEN_CONNECTOR_DELIVERY_API_KEY_BYTES + 1),
      ],
    ] as const) {
      await expect(
        loadOpenConnectorSetupConfig({
          dataFolder,
          environment: setupEnvironment({ [name]: value }),
        }),
      ).rejects.toThrow('visible ASCII');
    }
  });
});

test('setup rejects operator delivery API keys shorter than 32 bytes', async () => {
  await withDataFolder(async (dataFolder) => {
    await expect(
      loadOpenConnectorSetupConfig({
        dataFolder,
        environment: setupEnvironment({
          [OPEN_CONNECTOR_ENVIRONMENT.deliveryApiKey]: 'short-api-key',
        }),
      }),
    ).rejects.toThrow('must be between 32 and 8192 visible ASCII bytes');
  });
});
