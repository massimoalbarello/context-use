import {
  OWNER_USER_ID,
  OwnerRegistrationError,
  ownerRegistrationStatus,
} from '#lib/auth/owner-registration.ts';
import { OPEN_CONNECTOR_RECEIVER_ID_PATTERN } from '#lib/open-connector/config.ts';
import {
  canonicalOpenConnectorContent,
  canonicalOpenConnectorRecord,
  InvalidOpenConnectorDeliveryError,
  type OpenConnectorAcceptanceResult,
  type OpenConnectorDeliveryEnvelope,
  type OpenConnectorIntegrationBindingResult,
  type OpenConnectorRecordIdentity,
  type OpenConnectorSearchResult,
  type StoredOpenConnectorRecord,
  validateOpenConnectorDeliveryEnvelope,
} from '#models/open-connector/model.ts';
import type {
  OpenConnectorCredentialVerificationResult,
  OpenConnectorRecordsRepositoryContract,
} from '#repositories/open-connector/repository.ts';
import type { OwnerRegistrationRepositoryContract } from '#repositories/owner-registration/repository.ts';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function validateReceiverToken(receiverToken: string): void {
  if (receiverToken.length === 0) {
    throw new InvalidOpenConnectorDeliveryError('Invalid open-connector receiver token');
  }
}

function validateIntegrationInput({
  integrationId,
  ownerId,
}: {
  integrationId: string;
  ownerId: string;
}): void {
  if (!OPEN_CONNECTOR_RECEIVER_ID_PATTERN.test(integrationId)) {
    throw new InvalidOpenConnectorDeliveryError('Invalid open-connector integration ID');
  }
  if (ownerId.trim().length === 0 || ownerId !== ownerId.trim()) {
    throw new InvalidOpenConnectorDeliveryError('Invalid open-connector owner ID');
  }
}

export class OpenConnectorRecordsService {
  private readonly records: OpenConnectorRecordsRepositoryContract;
  private readonly ownerRegistration: OwnerRegistrationRepositoryContract;
  private readonly now: () => Date;

  constructor({
    records,
    ownerRegistration,
    now = () => new Date(),
  }: {
    records: OpenConnectorRecordsRepositoryContract;
    ownerRegistration: OwnerRegistrationRepositoryContract;
    now?: () => Date;
  }) {
    this.records = records;
    this.ownerRegistration = ownerRegistration;
    this.now = now;
  }

  async bindIntegration({
    integrationId,
    ownerId,
  }: {
    integrationId: string;
    ownerId: string;
  }): Promise<OpenConnectorIntegrationBindingResult> {
    validateIntegrationInput({ integrationId, ownerId });
    if (ownerId !== OWNER_USER_ID) {
      return { state: 'owner_not_found' };
    }
    let registration: { ownerRegistered: boolean };
    try {
      registration = ownerRegistrationStatus(await this.ownerRegistration.state());
    } catch (error) {
      if (
        error instanceof OwnerRegistrationError &&
        error.code === 'owner_registration_state_invalid'
      ) {
        return { state: 'owner_not_found' };
      }
      throw error;
    }
    if (!registration.ownerRegistered) {
      return { state: 'owner_not_found' };
    }
    return this.records.bindIntegration({
      integrationId,
      ownerId,
      createdAt: this.now().toISOString(),
    });
  }

  verifyReceiverToken({
    integrationId,
    ownerId,
    receiverToken,
    initializeIfMissing,
  }: {
    integrationId: string;
    ownerId: string;
    receiverToken: string;
    initializeIfMissing: boolean;
  }): Promise<OpenConnectorCredentialVerificationResult> {
    validateIntegrationInput({ integrationId, ownerId });
    validateReceiverToken(receiverToken);
    return this.records.verifyCredentialFingerprint({
      integrationId,
      ownerId,
      fingerprint: sha256(receiverToken),
      initializeIfMissing,
    });
  }

  async recordReceiverTokenRegistration({
    integrationId,
    ownerId,
    receiverToken,
  }: {
    integrationId: string;
    ownerId: string;
    receiverToken: string;
  }): Promise<void> {
    validateIntegrationInput({ integrationId, ownerId });
    validateReceiverToken(receiverToken);
    const recorded = await this.records.recordCredentialFingerprint({
      integrationId,
      ownerId,
      fingerprint: sha256(receiverToken),
    });
    if (!recorded) {
      throw new Error('Open-connector receiver credential has no trusted owner binding');
    }
  }

  accept({
    integrationId,
    ownerId,
    envelope,
    payloadHash,
  }: {
    integrationId: string;
    ownerId: string;
    envelope: OpenConnectorDeliveryEnvelope;
    payloadHash: string;
  }): Promise<OpenConnectorAcceptanceResult> {
    validateIntegrationInput({ integrationId, ownerId });
    if (!SHA256_PATTERN.test(payloadHash)) {
      throw new InvalidOpenConnectorDeliveryError(
        'Delivery payloadHash must be a lowercase SHA-256 digest',
      );
    }
    validateOpenConnectorDeliveryEnvelope(envelope);

    return this.records.accept({
      integrationId,
      ownerId,
      batchId: envelope.batchId,
      payloadHash,
      records: envelope.records.map((record) => ({
        record,
        contentJson: canonicalOpenConnectorContent(record.content),
        fingerprint: sha256(canonicalOpenConnectorRecord(record)),
      })),
      receivedAt: this.now().toISOString(),
    });
  }

  find(
    input: OpenConnectorRecordIdentity & { ownerId: string },
  ): Promise<StoredOpenConnectorRecord | null> {
    return this.records.find(input);
  }

  search(input: {
    ownerId: string;
    query: string;
    limit: number;
  }): Promise<OpenConnectorSearchResult[]> {
    return this.records.search(input);
  }
}

export type OpenConnectorRecordsServiceContract = Pick<
  OpenConnectorRecordsService,
  'accept' | 'bindIntegration' | 'find' | 'search'
>;

export type OpenConnectorRecordsRetrievalServiceContract = Pick<
  OpenConnectorRecordsService,
  'find' | 'search'
>;
