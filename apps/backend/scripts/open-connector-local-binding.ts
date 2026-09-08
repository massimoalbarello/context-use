import { createSqliteDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { OpenConnectorRecordsRepository } from '../src/repositories/open-connector/repository.ts';
import { OwnerRegistrationRepository } from '../src/repositories/owner-registration/repository.ts';
import { OpenConnectorRecordsService } from '../src/services/open-connector/service.ts';

export type OpenConnectorLocalBindingState = 'bound' | 'already_bound';

type VerifyReceiverCredentialInput = {
  integrationId: string;
  ownerId: string;
  receiverToken: string;
  initializeIfMissing: boolean;
};

async function verifyReceiverCredential({
  records,
  input,
}: {
  records: OpenConnectorRecordsService;
  input: VerifyReceiverCredentialInput;
}): Promise<void> {
  const state = await records.verifyReceiverToken(input);
  if (state === 'missing') {
    throw new Error(
      'No durable open-connector receiver credential is recorded. Run `bun run open-connector:setup -- register` before starting or continuing acquisition.',
    );
  }
  if (state === 'mismatch') {
    throw new Error(
      'The configured open-connector receiver token does not match its durable registration. Restore the registered token or run `bun run open-connector:setup -- register` to rotate it explicitly.',
    );
  }
  if (state === 'integration_not_found') {
    throw new Error('The open-connector receiver credential has no trusted owner binding.');
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
 * Establishes the receiver-to-owner trust boundary before setup mutates open-connector.
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
          'OPEN_CONNECTOR_RECEIVER_ID is already bound to a different Context Use owner. Restore the original owner mapping or choose a new receiver ID.',
        );
      }
      return result.state;
    },
  });
}

export async function verifyOpenConnectorReceiverCredential({
  dataFolder,
  integrationId,
  ownerId,
  receiverToken,
  initializeIfMissing,
}: {
  dataFolder: string;
  integrationId: string;
  ownerId: string;
  receiverToken: string;
  initializeIfMissing: boolean;
}): Promise<void> {
  await withOpenConnectorRecords({
    dataFolder,
    run: (records) =>
      verifyReceiverCredential({
        records,
        input: {
          integrationId,
          ownerId,
          receiverToken,
          initializeIfMissing,
        },
      }),
  });
}

export async function recordOpenConnectorReceiverRegistration({
  dataFolder,
  integrationId,
  ownerId,
  receiverToken,
}: {
  dataFolder: string;
  integrationId: string;
  ownerId: string;
  receiverToken: string;
}): Promise<void> {
  await withOpenConnectorRecords({
    dataFolder,
    run: (records) =>
      records.recordReceiverTokenRegistration({ integrationId, ownerId, receiverToken }),
  });
}
