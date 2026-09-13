import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';
import type { DeliveredRecord } from '#models/records/delivery-contract.generated.ts';
import type {
  RecordAcceptanceResult,
  RecordFilterOptions,
  RecordListFilters,
  RecordPage,
  RecordSummary,
  StoredRecord,
} from '#models/records/model.ts';
import { recordSearchText } from '#models/records/search.ts';
import type { Queries } from '#queries.gen.ts';
import { replaceSearchDocument } from '../search-index.ts';

class RecordAcceptanceConflict extends Error {
  constructor() {
    super('A record revision conflicts with stored content');
    this.name = 'RecordAcceptanceConflict';
  }
}

export type AcceptedRecord = {
  record: DeliveredRecord;
  readableId: string;
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
  revisionHash: string;
};

export type AcceptRecordsInput = {
  syncId: string;
  ownerId: string;
  records: AcceptedRecord[];
  receivedAt: string;
};

export type ListRecordsInput = RecordListFilters & {
  ownerId: string;
  limit: number;
  offset: number;
};

export interface RecordsRepositoryContract {
  accept(input: AcceptRecordsInput): Promise<RecordPublication>;
  listResources(input: ListRecordsInput): Promise<RecordPage>;
  filterOptions(input: { ownerId: string }): Promise<RecordFilterOptions>;
  findResource(input: {
    ownerId: string;
    readableId: string;
  }): Promise<(StoredRecord & { backlinks: KnowledgePageSummary[] }) | null>;
}

type RecordPublication = {
  result: RecordAcceptanceResult;
  storageKeys: Set<string>;
};

function recordSummaryFrom(
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

async function applyRecord({
  db,
  input,
  accepted,
  storageKeys,
}: {
  db: TypedSQL<Queries>;
  input: AcceptRecordsInput;
  accepted: AcceptedRecord;
  storageKeys: Set<string>;
}): Promise<void> {
  const { record } = accepted;
  const currentRows = await db.FindCurrentRecordRevision`
    /* @notNull revision revisionHash readableId storageKey */
    select "revision", "revision_hash" as "revisionHash", "readable_id" as "readableId",
      "storage_key" as "storageKey"
    from "record"
    where "owner_id" = ${input.ownerId} and "sync_id" = ${input.syncId}
      and "source_id" = ${record.sourceId}
      and "kind" = ${record.kind}
      and "record_id" = ${record.id}
  `;
  const current = currentRows[0];
  if (current) {
    const currentRevision = Number(current.revision);
    if (
      current.readableId !== accepted.readableId ||
      (currentRevision === record.revision && current.revisionHash !== accepted.revisionHash)
    ) {
      throw new RecordAcceptanceConflict();
    }
    if (currentRevision >= record.revision) {
      return;
    }
  }

  const content = record.operation === 'deleted' ? null : record.content;
  await db.ApplyRecordRevision`
    insert into "record"
      ("sync_id", "owner_id", "readable_id", "source_id", "kind", "record_id", "revision",
       "operation", "revision_hash", "storage_key", "content_hash", "size_bytes", "created_at", "updated_at",
       "provider", "title", "source_created_at", "source_updated_at")
    values
      (${input.syncId}, ${input.ownerId}, ${accepted.readableId}, ${record.sourceId}, ${record.kind},
       ${record.id}, ${record.revision}, ${record.operation}, ${accepted.revisionHash},
       ${accepted.storageKey}, ${accepted.contentHash}, ${accepted.sizeBytes},
       ${input.receivedAt}, ${input.receivedAt}, ${record.provider}, ${content?.title ?? null},
       ${content?.sourceCreatedAt ?? null}, ${content?.sourceUpdatedAt ?? null})
    on conflict ("owner_id", "sync_id", "source_id", "kind", "record_id") do update set
      "revision" = excluded."revision",
      "operation" = excluded."operation",
      "content_hash" = excluded."content_hash",
      "revision_hash" = excluded."revision_hash",
      "storage_key" = excluded."storage_key",
      "size_bytes" = excluded."size_bytes",
      "updated_at" = excluded."updated_at",
      "provider" = excluded."provider",
      "title" = excluded."title",
      "source_created_at" = excluded."source_created_at",
      "source_updated_at" = excluded."source_updated_at"
    where excluded."revision" > "record"."revision"
  `;
  if (current) {
    storageKeys.delete(current.storageKey);
  }
  storageKeys.add(accepted.storageKey);
  if (record.operation === 'deleted') {
    await db.RemoveRecordSearchDocument`
      delete from "hypermedia_search_document"
      where "owner_id" = ${input.ownerId} and "resource_type" = 'record'
        and "readable_id" = ${accepted.readableId}
    `;
  } else {
    const text = recordSearchText(record);
    await replaceSearchDocument({
      db,
      ownerId: input.ownerId,
      resourceType: 'record',
      readableId: accepted.readableId,
      label: record.content.title,
      body: text.body,
      metadata: text.metadata,
      participantNames: text.participantNames,
    });
  }
}

async function acceptDelivery({
  db,
  input,
}: {
  db: TypedSQL<Queries>;
  input: AcceptRecordsInput;
}): Promise<RecordPublication> {
  const storageKeys = new Set<string>();
  const syncs = await db.FindActiveRecordSyncForAcceptance`
    /* @notNull id ownerId */
    select "id", "owner_id" as "ownerId"
    from "record_sync"
    where "id" = ${input.syncId} and "owner_id" = ${input.ownerId} and "revoked_at" is null
  `;
  if (!syncs[0]) {
    return { result: { state: 'inactive_sync' }, storageKeys };
  }

  for (const record of input.records) {
    await applyRecord({ db, input, accepted: record, storageKeys });
  }
  return { result: { state: 'accepted' }, storageKeys };
}

export class RecordsRepository implements RecordsRepositoryContract {
  private readonly sql: TypedSQL<Queries>;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async accept(input: AcceptRecordsInput): Promise<RecordPublication> {
    try {
      return await this.serialize(() =>
        this.sql.begin('immediate', (db) => acceptDelivery({ db, input })),
      );
    } catch (error) {
      if (error instanceof RecordAcceptanceConflict) {
        return { result: { state: 'conflict' }, storageKeys: new Set() };
      }
      throw error;
    }
  }

  async listResources({
    ownerId,
    limit,
    offset,
    provider,
    kind,
    createdFrom,
    createdTo,
    updatedFrom,
    updatedTo,
    sortBy = 'sourceUpdatedAt',
    sortDirection = 'desc',
  }: ListRecordsInput): Promise<RecordPage> {
    return await this.serialize(async () => {
      const rows = await this.sql.ListRecordResources`
        /* @notNull readableId title provider kind recordId syncReadableId syncName createdAt updatedAt */
        select record."readable_id" as "readableId", record."title", record."provider", record."kind",
          record."record_id" as "recordId", record."source_created_at" as "sourceCreatedAt",
          record."source_updated_at" as "sourceUpdatedAt",
          sync."readable_id" as "syncReadableId", sync."name" as "syncName",
          record."created_at" as "createdAt", record."updated_at" as "updatedAt"
        from "record" record
        join "record_sync" sync on sync."id" = record."sync_id" and sync."owner_id" = record."owner_id"
        where record."owner_id" = ${ownerId} and record."operation" <> 'deleted'
          and (${provider ?? null} is null or record."provider" = ${provider ?? null})
          and (${kind ?? null} is null or record."kind" = ${kind ?? null})
          and (${createdFrom ?? null} is null or julianday(record."source_created_at") >= julianday(${createdFrom ?? null}))
          and (${createdTo ?? null} is null or julianday(record."source_created_at") < julianday(${createdTo ?? null}))
          and (${updatedFrom ?? null} is null or julianday(record."source_updated_at") >= julianday(${updatedFrom ?? null}))
          and (${updatedTo ?? null} is null or julianday(record."source_updated_at") < julianday(${updatedTo ?? null}))
        order by
          case ${sortBy} when 'sourceCreatedAt' then julianday(record."source_created_at") is null
            when 'sourceUpdatedAt' then julianday(record."source_updated_at") is null else 0 end,
          case when ${sortDirection} = 'asc' and ${sortBy} = 'sourceCreatedAt' then julianday(record."source_created_at") end asc,
          case when ${sortDirection} = 'asc' and ${sortBy} = 'sourceUpdatedAt' then julianday(record."source_updated_at") end asc,
          case when ${sortDirection} = 'desc' and ${sortBy} = 'sourceCreatedAt' then julianday(record."source_created_at") end desc,
          case when ${sortDirection} = 'desc' and ${sortBy} = 'sourceUpdatedAt' then julianday(record."source_updated_at") end desc,
        record."readable_id"
        limit ${limit + 1} offset ${offset}
      `;
      const items = rows.slice(0, limit).map(recordSummaryFrom);
      return {
        items,
        nextOffset: rows.length > limit ? offset + items.length : null,
        filterOptions: await this.readFilterOptions(ownerId),
      };
    });
  }

  filterOptions({ ownerId }: { ownerId: string }): Promise<RecordFilterOptions> {
    return this.serialize(() => this.readFilterOptions(ownerId));
  }

  private async readFilterOptions(ownerId: string): Promise<RecordFilterOptions> {
    const options = await this.sql.RecordFilterOptions`
      select distinct "provider", "kind" from "record"
      where "owner_id" = ${ownerId} and "operation" <> 'deleted'
      order by "provider", "kind"
    `;
    return {
      providers: [...new Set(options.map((row) => row.provider))],
      kinds: [...new Set(options.map((row) => row.kind))].sort(),
    };
  }

  async findResource({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<(StoredRecord & { backlinks: KnowledgePageSummary[] }) | null> {
    return await this.serialize(async () => {
      const rows = await this.sql.FindRecordResource`
        /* @notNull title provider syncReadableId syncName readableId kind recordId storageKey contentHash sizeBytes createdAt updatedAt */
        select record."title", record."provider", record."source_created_at" as "sourceCreatedAt",
          record."source_updated_at" as "sourceUpdatedAt",
          sync."readable_id" as "syncReadableId", sync."name" as "syncName",
          record."readable_id" as "readableId", record."kind", record."record_id" as "recordId",
          record."storage_key" as "storageKey", record."content_hash" as "contentHash",
          record."size_bytes" as "sizeBytes", record."created_at" as "createdAt",
          record."updated_at" as "updatedAt"
        from "record" record
        join "record_sync" sync
          on sync."id" = record."sync_id"
         and sync."owner_id" = record."owner_id"
        where record."owner_id" = ${ownerId} and record."readable_id" = ${readableId}
          and record."operation" <> 'deleted'
        limit 1
      `;
      const row = rows[0];
      return row
        ? {
            ...recordSummaryFrom(row),
            backlinks: await this.listBacklinks({ ownerId, readableId }),
            storageKey: row.storageKey,
            contentHash: row.contentHash,
            sizeBytes: Number(row.sizeBytes),
          }
        : null;
    });
  }

  private async listBacklinks({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<KnowledgePageSummary[]> {
    const rows = await this.sql.ListRecordBacklinks`
      /* @notNull id readableId revisionNumber title excerpt createdAt updatedAt */
      select page."id", page."readable_id" as "readableId", revision."revision_number" as "revisionNumber",
        revision."title", revision."excerpt", revision."temporal_coverage" as "temporalCoverage",
        page."created_at" as "createdAt", page."updated_at" as "updatedAt"
      from "knowledge_page_record_reference" reference
      join "knowledge_page" page on page."current_revision_id" = reference."source_revision_id"
        and page."owner_id" = reference."owner_id" and page."archived_at" is null
      join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
        and revision."owner_id" = page."owner_id"
      where reference."owner_id" = ${ownerId} and reference."target_record_readable_id" = ${readableId}
      order by revision."title", page."readable_id"
    `;
    return rows.map((row) => ({ ...row, revisionNumber: Number(row.revisionNumber) }));
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
