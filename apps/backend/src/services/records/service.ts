import canonicalize from 'canonicalize';
import type { Storage } from '#lib/storage/storage.ts';
import { readableIdFrom, readableIdWithSuffix } from '#models/readable-ids/model.ts';
import type {
  DeliveredRecord,
  RecordDeliveryEnvelope,
} from '#models/records/delivery-contract.generated.ts';
import type { RecordAcceptanceResult, RecordPage, RecordResource } from '#models/records/model.ts';
import type {
  AcceptedRecord,
  RecordsRepositoryContract,
} from '#repositories/records/repository.ts';

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
    const unusedKeys = new Set<string>();
    let result: RecordAcceptanceResult;
    try {
      const records: AcceptedRecord[] = [];
      for (const record of envelope.records) {
        const readableId = recordReadableId({ syncId, record });
        const storageKey = `${encodeURIComponent(ownerId)}/records/${encodeURIComponent(syncId)}/${readableId}/${Bun.randomUUIDv7()}.json`;
        const json = JSON.stringify(record);
        const file = new Blob([json], { type: 'application/json' });
        // Track the file before writing so a partial write is cleaned up too.
        unusedKeys.add(storageKey);
        const sizeBytes = await this.storage.write(storageKey, file);
        if (sizeBytes !== file.size) {
          throw new Error('Record file was not fully written');
        }
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
      // Keep committed files even if cleanup of other files fails.
      for (const key of publication.storageKeys) {
        unusedKeys.delete(key);
      }
      result = publication.result;
    } catch (error) {
      try {
        await this.discard(unusedKeys);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Record acceptance and cleanup failed');
      }
      throw error;
    }
    await this.discard(unusedKeys);
    return result;
  }

  listResources(input: { ownerId: string; limit: number; offset: number }): Promise<RecordPage> {
    return this.records.listResources(input);
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
    if (!(await this.storage.exists(storageKey))) {
      throw new Error(`Record file ${input.readableId} is missing`);
    }
    const bytes = new Uint8Array(await this.storage.file(storageKey).arrayBuffer());
    if (bytes.byteLength !== sizeBytes || sha256(bytes) !== contentHash) {
      throw new Error(`Record file ${input.readableId} failed its integrity check`);
    }
    const record: DeliveredRecord = JSON.parse(new TextDecoder().decode(bytes));
    if (record.operation === 'deleted') {
      throw new Error('An active record references a deletion');
    }
    return { ...summary, markdown: record.content.body, record };
  }

  private async discard(keys: Set<string>): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(keys, async (key) => {
        if (await this.storage.exists(key)) {
          await this.storage.delete(key);
        }
      }),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        'Could not remove unpublished record files',
      );
    }
  }
}

export type RecordDeliveryAcceptanceContract = Pick<RecordsService, 'accept'>;
export type RecordResourcesServiceContract = Pick<RecordsService, 'findResource' | 'listResources'>;
