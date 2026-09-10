import { readableIdFrom, readableIdWithSuffix } from '#models/readable-ids/model.ts';
import type { RecordDeliveryEnvelope } from '#models/records/delivery-contract.generated.ts';
import type {
  RecordAcceptanceResult,
  RecordIdentity,
  RecordPage,
  RecordResource,
} from '#models/records/model.ts';
import type { RecordsRepositoryContract } from '#repositories/records/repository.ts';

const RECORD_READABLE_ID_SUFFIX_LENGTH = 24;

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function recordReadableId({ syncId, sourceId, kind, recordId }: RecordIdentity): string {
  const suffix = sha256(JSON.stringify([syncId, sourceId, kind, recordId])).slice(
    0,
    RECORD_READABLE_ID_SUFFIX_LENGTH,
  );
  return readableIdWithSuffix({ readableId: readableIdFrom(`${kind}-${recordId}`), suffix });
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
    return await this.records.accept({
      syncId,
      ownerId,
      records: envelope.records.map((record) => {
        const markdown = record.operation === 'deleted' ? null : record.content.body;
        return {
          record,
          readableId: recordReadableId({
            syncId,
            sourceId: record.sourceId,
            kind: record.kind,
            recordId: record.id,
          }),
          markdown,
        };
      }),
      receivedAt: this.now().toISOString(),
    });
  }

  listResources(input: { ownerId: string; limit: number; offset: number }): Promise<RecordPage> {
    return this.records.listResources(input);
  }

  findResource(input: { ownerId: string; readableId: string }): Promise<RecordResource | null> {
    return this.records.findResource(input);
  }
}

export type RecordDeliveryAcceptanceContract = Pick<RecordsService, 'accept'>;
export type RecordResourcesServiceContract = Pick<RecordsService, 'findResource' | 'listResources'>;
