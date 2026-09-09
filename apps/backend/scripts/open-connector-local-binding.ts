import { createSqliteDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { OpenConnectorRecordsRepository } from '../src/repositories/open-connector/repository.ts';
import { OwnerRegistrationRepository } from '../src/repositories/owner-registration/repository.ts';
import { OpenConnectorRecordsService } from '../src/services/open-connector/service.ts';

export type OpenConnectorLocalBindingState = 'bound' | 'already_bound';

type VerifyDeliveryApiKeyInput = {
  integrationId: string;
  ownerId: string;
  deliveryApiKey: string;
};

async function verifyDeliveryApiKey({
  records,
  input,
}: {
  records: OpenConnectorRecordsService;
  input: VerifyDeliveryApiKeyInput;
}): Promise<void> {
  const state = await records.verifyDeliveryApiKey(input);
  if (state === 'missing') {
    throw new Error(
      'No durable open-connector delivery API key is recorded. Run `bun run open-connector:setup -- register` before starting or continuing acquisition.',
    );
  }
  if (state === 'mismatch') {
    throw new Error(
      'The configured open-connector delivery API key does not match its durable registration. Restore the registered key or run `bun run open-connector:setup -- register` to rotate it explicitly.',
    );
  }
  if (state === 'integration_not_found') {
    throw new Error('The open-connector delivery API key has no trusted owner binding.');
  }
}

async function withOpenConnectorRecords<T>({
  dataFolder,
  run,
}: {
  dataFolder: string;
  run: (records: OpenConnectorRecordsService) => Promise<T>;
}): Promise<T> {
  const database = await createSqliteDatabase({ dataFolder });
  try {
    await runMigrations({ db: database });
    return await run(
      new OpenConnectorRecordsService({
        records: new OpenConnectorRecordsRepository(database),
        ownerRegistration: new OwnerRegistrationRepository(database),
      }),
    );
  } finally {
    await database.close();
  }
}

/**
 * Establishes the integration-to-owner trust boundary before setup mutates open-connector.
 * The setup command gets a short-lived database connection and always releases it before
 * performing any network operation.
 */
export function bindOpenConnectorTrustedOwner({
  dataFolder,
  integrationId,
  ownerId,
}: {
  dataFolder: string;
  integrationId: string;
  ownerId: string;
}): Promise<OpenConnectorLocalBindingState> {
  return withOpenConnectorRecords({
    dataFolder,
    run: async (records) => {
      const result = await records.bindIntegration({ integrationId, ownerId });
      if (result.state === 'owner_not_found') {
        throw new Error(
          'OPEN_CONNECTOR_OWNER_ID does not identify the fully claimed Context Use owner. Complete passkey registration first, then retry.',
        );
      }
      if (result.state === 'conflict') {
        throw new Error(
          'OPEN_CONNECTOR_INTEGRATION_ID is already bound to a different Context Use owner. Restore the original owner mapping or choose a new integration ID.',
        );
      }
      return result.state;
    },
  });
}

export async function verifyOpenConnectorDeliveryApiKey({
  dataFolder,
  integrationId,
  ownerId,
  deliveryApiKey,
}: {
  dataFolder: string;
  integrationId: string;
  ownerId: string;
  deliveryApiKey: string;
}): Promise<void> {
  await withOpenConnectorRecords({
    dataFolder,
    run: (records) =>
      verifyDeliveryApiKey({
        records,
        input: {
          integrationId,
          ownerId,
          deliveryApiKey,
        },
      }),
  });
}

export async function recordOpenConnectorDeliveryApiKey({
  dataFolder,
  integrationId,
  ownerId,
  deliveryApiKey,
}: {
  dataFolder: string;
  integrationId: string;
  ownerId: string;
  deliveryApiKey: string;
}): Promise<void> {
  await withOpenConnectorRecords({
    dataFolder,
    run: (records) =>
      records.recordDeliveryApiKeyRegistration({ integrationId, ownerId, deliveryApiKey }),
  });
}
