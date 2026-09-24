import type { Storage } from '#backend/lib/storage/storage.ts';
import { readVerifiedText } from '#backend/lib/storage/verified-file.ts';
import type { ChangeContext } from '#backend/models/history/model.ts';
import { readableIdFrom, readableIdWithSuffix } from '#backend/models/readable-ids/model.ts';
import { recordAssetUsages } from '#backend/models/records/assets.ts';
import {
  parseRecord,
  type RecordDeletion,
  RecordDeletionSchema,
  type RecordInput,
  type RecordResource,
  type RecordSyncRevision,
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
function recordReadableId(input: { source: RecordDeletion['source']; syncId?: string }): string {
  const { source } = input;
  const identity = [source.provider, source.kind, source.id];
  if (input.syncId) {
    identity.push(input.syncId);
  }
  return readableIdWithSuffix({
    readableId: readableIdFrom(`${source.kind}-${source.id}`),
    suffix: sha256(JSON.stringify(identity)).slice(0, RECORD_ID_SUFFIX_LENGTH),
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
    sync,
  }: {
    ownerId: string;
    record: RecordInput;
    change: ChangeContext;
    sync?: RecordSyncRevision;
  }): Promise<RecordWriteResult> {
    const record = parseRecord(input);
    const assetUsages = recordAssetUsages(record.body);
    const readableId = recordReadableId({ source: record.source, syncId: sync?.syncId });
    const storageKey = `${encodeURIComponent(ownerId)}/records/${readableId}/${Bun.randomUUIDv7()}.md`;
    const file = new Blob([record.body], { type: 'text/markdown;charset=utf-8' });
    let result: RecordWriteResult;
    try {
      const sizeBytes = await this.storage.write(storageKey, file);
      if (sizeBytes !== file.size) {
        throw new Error('Record file was not fully written');
      }
      const publication = await this.records.write({
        ownerId,
        change,
        sync,
        readableId,
        receivedAt: this.now().toISOString(),
        value: { record, assetUsages, storageKey, sizeBytes, contentHash: sha256(record.body) },
      });
      if (publication.committed) {
        return publication.result;
      }
      result = publication.result;
    } catch (error) {
      try {
        await this.discard(storageKey);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Record write and cleanup failed');
      }
      throw error;
    }
    await this.discard(storageKey);
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
      readableId: recordReadableId({ source: deletion.source }),
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
    const body = await readVerifiedText({
      storage: this.storage,
      storageKey,
      contentHash,
      sizeBytes,
      label: `Record file ${input.readableId}`,
    });
    return { ...summary, body };
  }
  private async discard(storageKey: string): Promise<void> {
    if (await this.storage.exists(storageKey)) {
      await this.storage.delete(storageKey);
    }
  }
}

export type RecordsIngestionContract = Pick<RecordsService, 'upsert' | 'remove'>;
export type RecordResourcesServiceContract = Pick<
  RecordsService,
  'findResource' | 'listResources' | 'filterOptions'
>;
