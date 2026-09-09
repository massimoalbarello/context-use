import { expect, test } from 'bun:test';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import {
  loadOpenConnectorSetupConfig,
  OPEN_CONNECTOR_ENVIRONMENT,
} from '#lib/open-connector/config.ts';
import { openConnectorDeliveryApiKeyFileName } from '#lib/open-connector/delivery-api-key.ts';
import {
  bindOpenConnectorTrustedOwner,
  recordOpenConnectorDeliveryApiKey,
  verifyOpenConnectorDeliveryApiKey,
} from '../../scripts/open-connector-local-binding.ts';

const FIRST_OWNER_ID = OWNER_USER_ID;
const SECOND_OWNER_ID = 'context-use-owner-two';
const TIMESTAMP = '2026-09-08T00:00:00.000Z';

async function withDataFolder(run: (dataFolder: string) => Promise<void>): Promise<void> {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-open-connector-local-setup-'));
  try {
    await run(dataFolder);
  } finally {
    await rm(dataFolder, { recursive: true, force: true });
  }
}

async function seedOwners({
  dataFolder,
  ownerIds,
  passkeyOwnerIds = [],
}: {
  dataFolder: string;
  ownerIds: string[];
  passkeyOwnerIds?: string[];
}) {
  const database = await createSqliteDatabase({ dataFolder });
  try {
    await runMigrations({ db: database });
    for (const ownerId of ownerIds) {
      await database`
        insert into "auth_user"
          ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        values
          (${ownerId}, 'Owner', ${`${ownerId}@example.invalid`}, 1, ${TIMESTAMP}, ${TIMESTAMP})
      `;
      if (passkeyOwnerIds.includes(ownerId)) {
        await database`
          insert into "auth_passkey"
            ("id", "name", "publicKey", "userId", "credentialID", "counter", "deviceType",
             "backedUp", "createdAt")
          values
            (${`passkey-${ownerId}`}, 'Primary passkey', 'public-key', ${ownerId},
             ${`credential-${ownerId}`}, 0, 'singleDevice', 0, ${TIMESTAMP})
        `;
      }
    }
  } finally {
    await database.close();
  }
}

test('local setup refuses an unknown owner before creating an integration binding', async () => {
  await withDataFolder(async (dataFolder) => {
    await expect(
      bindOpenConnectorTrustedOwner({
        dataFolder,
        integrationId: 'context-use',
        ownerId: 'missing-owner',
      }),
    ).rejects.toThrow('does not identify the fully claimed Context Use owner');
  });
});

test('local setup refuses the fixed owner until passkey registration is complete', async () => {
  await withDataFolder(async (dataFolder) => {
    await seedOwners({ dataFolder, ownerIds: [FIRST_OWNER_ID] });

    await expect(
      bindOpenConnectorTrustedOwner({
        dataFolder,
        integrationId: 'context-use',
        ownerId: FIRST_OWNER_ID,
      }),
    ).rejects.toThrow('does not identify the fully claimed Context Use owner');
  });
});

test('local setup persists one stable binding to the claimed owner', async () => {
  await withDataFolder(async (dataFolder) => {
    await seedOwners({
      dataFolder,
      ownerIds: [FIRST_OWNER_ID, SECOND_OWNER_ID],
      passkeyOwnerIds: [FIRST_OWNER_ID, SECOND_OWNER_ID],
    });

    await expect(
      bindOpenConnectorTrustedOwner({
        dataFolder,
        integrationId: 'context-use',
        ownerId: FIRST_OWNER_ID,
      }),
    ).resolves.toBe('bound');
    await expect(
      bindOpenConnectorTrustedOwner({
        dataFolder,
        integrationId: 'context-use',
        ownerId: FIRST_OWNER_ID,
      }),
    ).resolves.toBe('already_bound');
    await expect(
      bindOpenConnectorTrustedOwner({
        dataFolder,
        integrationId: 'context-use',
        ownerId: SECOND_OWNER_ID,
      }),
    ).rejects.toThrow('does not identify the fully claimed Context Use owner');
  });
});

test('local setup detects an existing integration bound to a different database owner', async () => {
  await withDataFolder(async (dataFolder) => {
    await seedOwners({
      dataFolder,
      ownerIds: [FIRST_OWNER_ID, SECOND_OWNER_ID],
      passkeyOwnerIds: [FIRST_OWNER_ID],
    });
    const database = await createSqliteDatabase({ dataFolder });
    try {
      await database`
        insert into "open_connector_integration" ("id", "owner_id", "name", "created_at")
        values ('context-use', ${SECOND_OWNER_ID}, 'Existing service', ${TIMESTAMP})
      `;
    } finally {
      await database.close();
    }

    await expect(
      bindOpenConnectorTrustedOwner({
        dataFolder,
        integrationId: 'context-use',
        ownerId: FIRST_OWNER_ID,
      }),
    ).rejects.toThrow('already bound to a different Context Use owner');
  });
});

test('a lost delivery API key requires explicit registration before it is trusted', async () => {
  await withDataFolder(async (dataFolder) => {
    await seedOwners({
      dataFolder,
      ownerIds: [FIRST_OWNER_ID],
      passkeyOwnerIds: [FIRST_OWNER_ID],
    });
    const environment = {
      [OPEN_CONNECTOR_ENVIRONMENT.baseUrl]: 'http://127.0.0.1:8787',
      [OPEN_CONNECTOR_ENVIRONMENT.adminToken]: 'admin-token',
      [OPEN_CONNECTOR_ENVIRONMENT.integrationId]: 'context-use',
      [OPEN_CONNECTOR_ENVIRONMENT.callbackUrl]:
        'https://context-use.example/api/integrations/open-connector/records',
      [OPEN_CONNECTOR_ENVIRONMENT.deliveryApiKey]: '',
      [OPEN_CONNECTOR_ENVIRONMENT.ownerId]: FIRST_OWNER_ID,
    };
    const original = await loadOpenConnectorSetupConfig({ dataFolder, environment });
    expect(
      await bindOpenConnectorTrustedOwner({
        dataFolder,
        integrationId: original.integrationId,
        ownerId: original.ownerId,
      }),
    ).toBe('bound');
    await recordOpenConnectorDeliveryApiKey({
      dataFolder,
      integrationId: original.integrationId,
      ownerId: original.ownerId,
      deliveryApiKey: original.deliveryApiKey,
    });

    await unlink(join(dataFolder, openConnectorDeliveryApiKeyFileName(original.integrationId)));
    let replacementApiKey = '';
    for (const expectedSource of ['generated-file', 'stored-file'] as const) {
      const replacement = await loadOpenConnectorSetupConfig({
        dataFolder,
        environment,
      });
      replacementApiKey = replacement.deliveryApiKey;
      expect(replacement.deliveryApiKey).not.toBe(original.deliveryApiKey);
      expect(replacement.deliveryApiKeySource.kind).toBe(expectedSource);
      await expect(
        verifyOpenConnectorDeliveryApiKey({
          dataFolder,
          integrationId: replacement.integrationId,
          ownerId: replacement.ownerId,
          deliveryApiKey: replacement.deliveryApiKey,
        }),
      ).rejects.toThrow('does not match its durable registration');
    }

    await recordOpenConnectorDeliveryApiKey({
      dataFolder,
      integrationId: original.integrationId,
      ownerId: original.ownerId,
      deliveryApiKey: replacementApiKey,
    });
    await expect(
      verifyOpenConnectorDeliveryApiKey({
        dataFolder,
        integrationId: original.integrationId,
        ownerId: original.ownerId,
        deliveryApiKey: replacementApiKey,
      }),
    ).resolves.toBeUndefined();
  });
});
