import canonicalize from 'canonicalize';
import type { Storage } from '#backend/lib/storage/storage.ts';
import { readVerifiedText } from '#backend/lib/storage/verified-text.ts';
import type { ChangeContext } from '#backend/models/history/model.ts';
import { readableIdFrom, readableIdWithSuffix } from '#backend/models/readable-ids/model.ts';
import {
  parseRecord,
  type RecordDeletion,
  RecordDeletionSchema,
  type RecordInput,
  RecordInputSchema,
  type RecordResource,
  type RecordWriteResult,
} from '#backend/models/records/model.ts';
import type {
  ListRecordsInput,
  RecordsRepositoryContract,
} from '#backend/repositories/records/repository.ts';

const RECORD_ID_SUFFIX_LENGTH = 24;

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
function recordReadableId(source: RecordDeletion['source']): string {
  return readableIdWithSuffix({
    readableId: readableIdFrom(`${source.kind}-${source.id}`),
    suffix: sha256(JSON.stringify([source.provider, source.kind, source.id])).slice(
      0,
      RECORD_ID_SUFFIX_LENGTH,
    ),
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
  }: { records: RecordsRepositoryContract; storage: Storage; now?: () => Date }) {
    this.records = records;
    this.storage = storage;
    this.now = now;
  }

  async upsert({
    ownerId,
    record: input,
    change,
  }: {
    ownerId: string;
    record: RecordInput;
    change: ChangeContext;
  }): Promise<RecordWriteResult> {
    const record = parseRecord(input);
    const readableId = recordReadableId(record.source);
    const storageKey = `${encodeURIComponent(ownerId)}/records/${readableId}/${Bun.randomUUIDv7()}.json`;
    const json = canonicalize(record)!;
    const file = new Blob([json], { type: 'application/json' });
    const unusedKeys = new Set([storageKey]);
    let result: RecordWriteResult;
    try {
      const sizeBytes = await this.storage.write(storageKey, file);
      if (sizeBytes !== file.size) {
        throw new Error('Record file was not fully written');
      }
      const publication = await this.records.write({
        ownerId,
        change,
        readableId,
        receivedAt: this.now().toISOString(),
        value: { record, storageKey, sizeBytes, contentHash: sha256(json) },
      });
      if (publication.committed) {
        unusedKeys.delete(storageKey);
      }
      result = publication.result;
    } catch (error) {
      try {
        await this.discard(unusedKeys);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Record write and cleanup failed');
      }
      throw error;
    }
    await this.discard(unusedKeys);
    return result;
  }
  async remove({
    ownerId,
    change,
    ...input
  }: RecordDeletion & { ownerId: string; change: ChangeContext }): Promise<RecordWriteResult> {
    const parsed = RecordDeletionSchema.parse(input);
    const deletion = { ...parsed, sourceUpdatedAt: new Date(parsed.sourceUpdatedAt).toISOString() };
    const publication = await this.records.write({
      ownerId,
      deletion,
      change,
      readableId: recordReadableId(deletion.source),
      receivedAt: this.now().toISOString(),
    });
    return publication.result;
  }
  listResources(input: ListRecordsInput) {
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
    const record = RecordInputSchema.parse(
      JSON.parse(
        await readVerifiedText({
          storage: this.storage,
          storageKey,
          contentHash,
          sizeBytes,
          label: `Record file ${input.readableId}`,
        }),
      ),
    );
    return { ...summary, body: record.body };
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

export type RecordsIngestionContract = Pick<RecordsService, 'upsert' | 'remove'>;
export type RecordResourcesServiceContract = Pick<
  RecordsService,
  'findResource' | 'listResources' | 'filterOptions'
>;
