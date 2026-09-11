import type { SQL } from 'bun';
import type { Storage } from '#lib/storage/storage.ts';
import type {
  RecordAcceptanceResult,
  RecordPage,
  RecordResource,
  RecordSummary,
} from '#models/records/model.ts';
import { RecordCatalog } from './catalog.ts';
import type {
  AcceptRecordsInput,
  ListRecordsInput,
  RecordsRepositoryContract,
} from './contract.ts';
import { RecordFiles, type StagedRecordFile } from './files.ts';

function summary(
  record: Omit<RecordSummary, 'sync'> & { syncReadableId: string; syncName: string },
): RecordSummary {
  return {
    readableId: record.readableId,
    title: record.title,
    provider: record.provider,
    sourceCreatedAt: record.sourceCreatedAt,
    sourceUpdatedAt: record.sourceUpdatedAt,
    kind: record.kind,
    recordId: record.recordId,
    sync: { readableId: record.syncReadableId, name: record.syncName },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class RecordsRepository implements RecordsRepositoryContract {
  private readonly catalog: RecordCatalog;
  private readonly files: RecordFiles;

  constructor({ sql, storage }: { sql: SQL; storage: Storage }) {
    this.catalog = new RecordCatalog(sql);
    this.files = new RecordFiles(storage);
  }

  async accept(input: AcceptRecordsInput): Promise<RecordAcceptanceResult> {
    if (!(await this.catalog.isActive(input))) {
      return { state: 'inactive_sync' };
    }
    const attemptedKeys = new Set<string>();
    let result: RecordAcceptanceResult;
    try {
      const staged: StagedRecordFile[] = [];
      for (const accepted of input.records) {
        staged.push(await this.files.stage({ input, accepted, attemptedKeys }));
      }
      const publication = await this.catalog.publish({ input, files: staged });
      // Never delete a published file, even if cleanup of other candidates fails.
      for (const key of publication.publishedKeys) {
        attemptedKeys.delete(key);
      }
      result = publication.result;
    } catch (error) {
      try {
        await this.files.discard(attemptedKeys);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Record acceptance and cleanup failed');
      }
      throw error;
    }
    await this.files.discard(attemptedKeys);
    return result;
  }

  async listResources(input: ListRecordsInput): Promise<RecordPage> {
    const { ownerId, limit, offset } = input;
    const rows = await this.catalog.list({ ...input, limit: limit + 1 });
    const items = rows.slice(0, limit).map(summary);
    return {
      items,
      nextOffset: rows.length > limit ? offset + items.length : null,
      filterOptions: await this.catalog.filterOptions(ownerId),
    };
  }

  async findResource(input: {
    ownerId: string;
    readableId: string;
  }): Promise<RecordResource | null> {
    const stored = await this.catalog.find(input);
    if (!stored) {
      return null;
    }
    const record = await this.files.read(stored);
    if (record.operation === 'deleted') {
      throw new Error('An active catalog record references a tombstone');
    }
    return { ...summary(stored), markdown: record.content.body, record };
  }
}
