import {
  OWNER_USER_ID,
  OwnerRegistrationError,
  ownerRegistrationStatus,
} from '#lib/auth/owner-registration.ts';
import {
  canonicalOpenConnectorContent,
  canonicalOpenConnectorRecord,
  InvalidOpenConnectorDeliveryError,
  isOpenConnectorDeliveryApiKey,
  MAX_OPEN_CONNECTOR_INTEGRATION_NAME_LENGTH,
  OPEN_CONNECTOR_INTEGRATION_ID_PATTERN,
  type OpenConnectorAcceptanceResult,
  type OpenConnectorDeliveryEnvelope,
  type OpenConnectorIntegrationBindingResult,
  type OpenConnectorIntegrationPrincipal,
  type OpenConnectorRecordIdentity,
  type OpenConnectorRecordPage,
  type OpenConnectorRecordResource,
  type OpenConnectorSearchResult,
  openConnectorRecordPresentation,
  type StoredOpenConnectorRecord,
  validateOpenConnectorDeliveryEnvelope,
} from '#models/open-connector/model.ts';
import { readableIdFrom, readableIdWithSuffix } from '#models/readable-ids/model.ts';
import type {
  OpenConnectorCredentialVerificationResult,
  OpenConnectorRecordsRepositoryContract,
} from '#repositories/open-connector/repository.ts';
import type { OwnerRegistrationRepositoryContract } from '#repositories/owner-registration/repository.ts';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RECORD_READABLE_ID_SUFFIX_LENGTH = 24;

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function validateDeliveryApiKey(deliveryApiKey: string): void {
  if (!isOpenConnectorDeliveryApiKey(deliveryApiKey)) {
    throw new InvalidOpenConnectorDeliveryError('Invalid open-connector delivery API key');
  }
}

function validateIntegrationInput({
  integrationId,
  ownerId,
}: {
  integrationId: string;
  ownerId: string;
}): void {
  if (!OPEN_CONNECTOR_INTEGRATION_ID_PATTERN.test(integrationId)) {
    throw new InvalidOpenConnectorDeliveryError('Invalid open-connector integration ID');
  }
  if (ownerId.trim().length === 0 || ownerId !== ownerId.trim()) {
    throw new InvalidOpenConnectorDeliveryError('Invalid open-connector owner ID');
  }
}

function integrationName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_OPEN_CONNECTOR_INTEGRATION_NAME_LENGTH) {
    throw new InvalidOpenConnectorDeliveryError('Invalid open-connector integration name');
  }
  return name;
}

function recordReadableId({
  integrationId,
  sourceId,
  kind,
  recordId,
  title,
}: OpenConnectorRecordIdentity & { title: string }): string {
  const suffix = sha256(JSON.stringify([integrationId, sourceId, kind, recordId])).slice(
    0,
    RECORD_READABLE_ID_SUFFIX_LENGTH,
  );
  return readableIdWithSuffix({ readableId: readableIdFrom(title), suffix });
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
    name = integrationId,
  }: {
    integrationId: string;
    ownerId: string;
    name?: string;
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
      name: integrationName(name),
      createdAt: this.now().toISOString(),
    });
  }

  async authenticateDeliveryApiKey({
    deliveryApiKey,
  }: {
    deliveryApiKey: string;
  }): Promise<OpenConnectorIntegrationPrincipal | null> {
    validateDeliveryApiKey(deliveryApiKey);
    return await this.records.authenticateCredentialFingerprint({
      fingerprint: sha256(deliveryApiKey),
    });
  }

  verifyDeliveryApiKey({
    integrationId,
    ownerId,
    deliveryApiKey,
  }: {
    integrationId: string;
    ownerId: string;
    deliveryApiKey: string;
  }): Promise<OpenConnectorCredentialVerificationResult> {
    validateIntegrationInput({ integrationId, ownerId });
    validateDeliveryApiKey(deliveryApiKey);
    return this.records.verifyCredentialFingerprint({
      integrationId,
      ownerId,
      fingerprint: sha256(deliveryApiKey),
    });
  }

  async recordDeliveryApiKeyRegistration({
    integrationId,
    ownerId,
    deliveryApiKey,
  }: {
    integrationId: string;
    ownerId: string;
    deliveryApiKey: string;
  }): Promise<void> {
    validateIntegrationInput({ integrationId, ownerId });
    validateDeliveryApiKey(deliveryApiKey);
    const recorded = await this.records.recordCredentialFingerprint({
      integrationId,
      ownerId,
      fingerprint: sha256(deliveryApiKey),
    });
    if (!recorded) {
      throw new Error('Open-connector delivery API key has no trusted owner binding');
    }
  }

  async accept({
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

    return await this.records.accept({
      integrationId,
      ownerId,
      batchId: envelope.batchId,
      payloadHash,
      records: envelope.records.map((record) => {
        const presentation = openConnectorRecordPresentation(record.content?.body ?? 'Record');
        return {
          record,
          readableId: recordReadableId({
            integrationId,
            sourceId: record.sourceId,
            kind: record.kind,
            recordId: record.id,
            title: presentation.title,
          }),
          ...presentation,
          contentJson: canonicalOpenConnectorContent(record.content),
          fingerprint: sha256(canonicalOpenConnectorRecord(record)),
        };
      }),
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

  listResources(input: {
    ownerId: string;
    limit: number;
    offset: number;
  }): Promise<OpenConnectorRecordPage> {
    return this.records.listResources(input);
  }

  findResource(input: {
    ownerId: string;
    readableId: string;
  }): Promise<OpenConnectorRecordResource | null> {
    return this.records.findResource(input);
  }
}

export type OpenConnectorRecordsServiceContract = Pick<
  OpenConnectorRecordsService,
  | 'accept'
  | 'authenticateDeliveryApiKey'
  | 'bindIntegration'
  | 'find'
  | 'findResource'
  | 'listResources'
  | 'search'
>;

export type OpenConnectorRecordsRetrievalServiceContract = Pick<
  OpenConnectorRecordsService,
  'find' | 'search'
>;

export type OpenConnectorRecordResourcesServiceContract = Pick<
  OpenConnectorRecordsService,
  'findResource' | 'listResources'
>;
