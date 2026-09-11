import type { SQL } from 'bun';
import type { Storage } from '#lib/storage/storage.ts';
import type {
  RecordAcceptanceResult,
  RecordPage,
  RecordResource,
  RecordSummary,
} from '#models/records/model.ts';
import { type CatalogRecord, RecordCatalog } from './catalog.ts';
import type { AcceptRecordsInput, RecordsRepositoryContract } from './contract.ts';
import { type RecordFileReference, RecordFiles } from './files.ts';

function summary({
  head,
  record,
}: {
  head: CatalogRecord;
  record: RecordResource['record'];
}): RecordSummary {
  return {
    readableId: head.readableId,
    kind: record.kind,
    recordId: record.id,
    sync: { readableId: head.syncReadableId, name: head.syncName },
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
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
      const staged: RecordFileReference[] = [];
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

  async listResources({
    ownerId,
    limit,
    offset,
  }: {
    ownerId: string;
    limit: number;
    offset: number;
  }): Promise<RecordPage> {
    const heads = await this.catalog.list({ ownerId, limit: limit + 1, offset });
    const items: RecordSummary[] = [];
    for (const head of heads.slice(0, limit)) {
      items.push(summary({ head, record: await this.readActive(head) }));
    }
    return { items, nextOffset: heads.length > limit ? offset + items.length : null };
  }

  async findResource(input: {
    ownerId: string;
    readableId: string;
  }): Promise<RecordResource | null> {
    const head = await this.catalog.find(input);
    if (!head) {
      return null;
    }
    const record = await this.readActive(head);
    return { ...summary({ head, record }), markdown: record.content.body, record };
  }

  private async readActive(head: CatalogRecord): Promise<RecordResource['record']> {
    const record = await this.files.read(head);
    if (record.operation === 'deleted') {
      throw new Error('An active catalog record references a tombstone');
    }
    return record;
  }
}
