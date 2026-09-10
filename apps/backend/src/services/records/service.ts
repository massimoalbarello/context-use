import { readableIdFrom, readableIdWithSuffix } from '#models/readable-ids/model.ts';
import {
  canonicalDeliveredRecord,
  type ExternalRecordIdentity,
  InvalidRecordDeliveryError,
  type RecordAcceptanceResult,
  type RecordDeliveryEnvelope,
  type RecordIdentity,
  type RecordPage,
  type RecordResource,
  type RecordSearchResult,
  recordPresentation,
  type StoredRecord,
  validateRecordDeliveryEnvelope,
} from '#models/records/model.ts';
import { isUuidV7 } from '#models/syncs/model.ts';
import type { RecordsRepositoryContract } from '#repositories/records/repository.ts';

const RECORD_READABLE_ID_SUFFIX_LENGTH = 24;

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function validatePrincipal({ syncId, ownerId }: { syncId: string; ownerId: string }): void {
  if (!isUuidV7(syncId)) {
    throw new InvalidRecordDeliveryError('Invalid record sync ID');
  }
  if (ownerId.trim().length === 0 || ownerId !== ownerId.trim()) {
    throw new InvalidRecordDeliveryError('Invalid record owner ID');
  }
}

function recordReadableId({
  syncId,
  sourceId,
  kind,
  recordId,
  title,
}: RecordIdentity & { title: string }): string {
  const suffix = sha256(JSON.stringify([syncId, sourceId, kind, recordId])).slice(
    0,
    RECORD_READABLE_ID_SUFFIX_LENGTH,
  );
  return readableIdWithSuffix({ readableId: readableIdFrom(title), suffix });
}

export class RecordsService {
  private readonly records: RecordsRepositoryContract;
  private readonly now: () => Date;

  constructor({
    records,
    now = () => new Date(),
  }: {
    records: RecordsRepositoryContract;
    now?: () => Date;
  }) {
    this.records = records;
    this.now = now;
  }

  async accept({
    syncId,
    ownerId,
    envelope,
  }: {
    syncId: string;
    ownerId: string;
    envelope: RecordDeliveryEnvelope;
  }): Promise<RecordAcceptanceResult> {
    validatePrincipal({ syncId, ownerId });
    validateRecordDeliveryEnvelope(envelope);

    return await this.records.accept({
      syncId,
      ownerId,
      records: envelope.records.map((record) => {
        const presentation = recordPresentation(record.content?.body ?? 'Record');
        return {
          record,
          readableId: recordReadableId({
            syncId,
            sourceId: record.sourceId,
            kind: record.kind,
            recordId: record.id,
            title: presentation.title,
          }),
          ...presentation,
          markdown: record.content?.body ?? null,
          revisionFingerprint: sha256(canonicalDeliveredRecord(record)),
        };
      }),
      receivedAt: this.now().toISOString(),
    });
  }

  find(input: ExternalRecordIdentity & { ownerId: string }): Promise<StoredRecord | null> {
    return this.records.find(input);
  }

  search(input: { ownerId: string; query: string; limit: number }): Promise<RecordSearchResult[]> {
    return this.records.search(input);
  }

  listResources(input: { ownerId: string; limit: number; offset: number }): Promise<RecordPage> {
    return this.records.listResources(input);
  }

  findResource(input: { ownerId: string; readableId: string }): Promise<RecordResource | null> {
    return this.records.findResource(input);
  }
}

export type RecordDeliveryAcceptanceContract = Pick<RecordsService, 'accept'>;
export type RecordsRetrievalServiceContract = Pick<RecordsService, 'find' | 'search'>;
export type RecordResourcesServiceContract = Pick<RecordsService, 'findResource' | 'listResources'>;
