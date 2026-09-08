import { expect, test } from 'bun:test';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import {
  loadOpenConnectorReceiverRuntimeConfig,
  OPEN_CONNECTOR_ENVIRONMENT,
} from '#lib/open-connector/config.ts';
import { OPEN_CONNECTOR_RECEIVER_SECRET_FILE_NAME } from '#lib/open-connector/receiver-secret.ts';
import {
  bindOpenConnectorTrustedOwner,
  recordOpenConnectorReceiverRegistration,
  verifyOpenConnectorReceiverCredential,
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
        insert into "open_connector_integration" ("id", "owner_id", "created_at")
        values ('context-use', ${SECOND_OWNER_ID}, ${TIMESTAMP})
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

test('a lost receiver token cannot be adopted implicitly on either of two restarts', async () => {
  await withDataFolder(async (dataFolder) => {
    await seedOwners({
      dataFolder,
      ownerIds: [FIRST_OWNER_ID],
      passkeyOwnerIds: [FIRST_OWNER_ID],
    });
    const environment = {
      [OPEN_CONNECTOR_ENVIRONMENT.receiverId]: 'context-use',
      [OPEN_CONNECTOR_ENVIRONMENT.ownerId]: FIRST_OWNER_ID,
    };
    const original = await loadOpenConnectorReceiverRuntimeConfig({ dataFolder, environment });
    if (!original) {
      throw new Error('Expected receiver configuration');
    }
    expect(
      await bindOpenConnectorTrustedOwner({
        dataFolder,
        integrationId: original.integrationId,
        ownerId: original.ownerId,
      }),
    ).toBe('bound');
    await verifyOpenConnectorReceiverCredential({
      dataFolder,
      integrationId: original.integrationId,
      ownerId: original.ownerId,
      receiverToken: original.bearerToken,
      initializeIfMissing: true,
    });

    await unlink(join(dataFolder, OPEN_CONNECTOR_RECEIVER_SECRET_FILE_NAME));
    let replacementToken = '';
    for (const expectedSource of ['generated-file', 'stored-file'] as const) {
      const replacement = await loadOpenConnectorReceiverRuntimeConfig({
        dataFolder,
        environment,
      });
      if (!replacement) {
        throw new Error('Expected receiver configuration');
      }
      replacementToken = replacement.bearerToken;
      expect(replacement.bearerToken).not.toBe(original.bearerToken);
      expect(replacement.bearerTokenSource.kind).toBe(expectedSource);
      await expect(
        verifyOpenConnectorReceiverCredential({
          dataFolder,
          integrationId: replacement.integrationId,
          ownerId: replacement.ownerId,
          receiverToken: replacement.bearerToken,
          initializeIfMissing: false,
        }),
      ).rejects.toThrow('does not match its durable registration');
    }

    await recordOpenConnectorReceiverRegistration({
      dataFolder,
      integrationId: original.integrationId,
      ownerId: original.ownerId,
      receiverToken: replacementToken,
    });
    await expect(
      verifyOpenConnectorReceiverCredential({
        dataFolder,
        integrationId: original.integrationId,
        ownerId: original.ownerId,
        receiverToken: replacementToken,
        initializeIfMissing: false,
      }),
    ).resolves.toBeUndefined();
  });
});
