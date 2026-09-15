import canonicalize from 'canonicalize';
import { publishFiles } from '#backend/lib/storage/publication.ts';
import type { Storage } from '#backend/lib/storage/storage.ts';
import { readVerifiedText } from '#backend/lib/storage/verified-text.ts';
import { readableIdFrom, readableIdWithSuffix } from '#backend/models/readable-ids/model.ts';
import type {
  DeliveredRecord,
  RecordDeliveryEnvelope,
} from '#backend/models/records/delivery-contract.generated.ts';
import type {
  RecordAcceptanceResult,
  RecordPage,
  RecordResource,
} from '#backend/models/records/model.ts';
import type {
  AcceptedRecord,
  ListRecordsInput,
  RecordsRepositoryContract,
} from '#backend/repositories/records/repository.ts';

const RECORD_READABLE_ID_SUFFIX_LENGTH = 24;

function sha256(value: string | Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function recordReadableId({ syncId, record }: { syncId: string; record: DeliveredRecord }): string {
  const suffix = sha256(JSON.stringify([syncId, record.sourceId, record.kind, record.id])).slice(
    0,
    RECORD_READABLE_ID_SUFFIX_LENGTH,
  );
  return readableIdWithSuffix({
    readableId: readableIdFrom(`${record.kind}-${record.id}`),
    suffix,
  });
}

export class RecordsService {
  private readonly records: RecordsRepositoryContract;
  private readonly storage: Storage;
  private readonly now: () => Date;

  constructor({
    records,
    storage,
    now = () => new Date(),
  }: {
    records: RecordsRepositoryContract;
    storage: Storage;
    now?: () => Date;
  }) {
    this.records = records;
    this.storage = storage;
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
    const receivedAt = this.now().toISOString();
    return await publishFiles({
      storage: this.storage,
      publish: async (files) => {
        const records: AcceptedRecord[] = [];
        for (const record of envelope.records) {
          const readableId = recordReadableId({ syncId, record });
          const storageKey = `${encodeURIComponent(ownerId)}/records/${encodeURIComponent(syncId)}/${readableId}/${Bun.randomUUIDv7()}.json`;
          const json = JSON.stringify(record);
          const file = new Blob([json], { type: 'application/json' });
          const sizeBytes = await files.write({ key: storageKey, file });
          const { eventId: _eventId, ...revision } = record;
          records.push({
            record,
            readableId,
            storageKey,
            sizeBytes,
            contentHash: sha256(json),
            revisionHash: sha256(canonicalize(revision)!),
          });
        }
        const publication = await this.records.accept({
          syncId,
          ownerId,
          records,
          receivedAt,
        });
        files.retain(publication.storageKeys);
        return publication.result;
      },
    });
  }

  listResources(input: ListRecordsInput): Promise<RecordPage> {
    return this.records.listResources(input);
  }

  filterOptions(input: { ownerId: string }) {
    return this.records.filterOptions(input);
  }

  async findResource(input: {
    ownerId: string;
    readableId: string;
  }): Promise<RecordResource | null> {
    const stored = await this.records.findResource(input);
    if (!stored) {
      return null;
    }
    const { storageKey, contentHash, sizeBytes, ...summary } = stored;
    const record: DeliveredRecord = JSON.parse(
      await readVerifiedText({
        storage: this.storage,
        storageKey,
        contentHash,
        sizeBytes,
        label: `Record file ${input.readableId}`,
      }),
    );
    if (record.operation === 'deleted') {
      throw new Error('An active record references a deletion');
    }
    return { ...summary, markdown: record.content.body, record };
  }
}

export type RecordDeliveryAcceptanceContract = Pick<RecordsService, 'accept'>;
export type RecordResourcesServiceContract = Pick<
  RecordsService,
  'findResource' | 'listResources' | 'filterOptions'
>;
