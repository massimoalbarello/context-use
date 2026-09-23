import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import { type ChangeContext, changedText } from '#backend/models/history/model.ts';
import type { KnowledgePageSummary } from '#backend/models/knowledge-pages/model.ts';
import { InvalidRecordAssetError, type RecordAssetUsage } from '#backend/models/records/assets.ts';
import type {
  NativeRecord,
  RecordDeletion,
  RecordFilterOptions,
  RecordListFilters,
  RecordPage,
  RecordSummary,
  RecordSyncRevision,
  RecordWriteResult,
  StoredRecord,
} from '#backend/models/records/model.ts';
import { recordSearchText } from '#backend/models/records/search.ts';
import type { Queries } from '#backend/queries.gen.ts';
import { recordChange } from '../record-change.ts';
import { replaceSearchDocument } from '../search-index.ts';

export type PreparedRecord = {
  record: NativeRecord;
  assetUsages: RecordAssetUsage[];
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
};
export type WriteRecordInput = {
  change: ChangeContext;
  ownerId: string;
  readableId: string;
  receivedAt: string;
  sync?: RecordSyncRevision;
} & ({ value: PreparedRecord; deletion?: never } | { deletion: RecordDeletion; value?: never });
export type ListRecordsInput = RecordListFilters & {
  ownerId: string;
  limit: number;
  offset: number;
};
export interface RecordsRepositoryContract {
  write(input: WriteRecordInput): Promise<RecordPublication>;
  listResources(input: ListRecordsInput): Promise<RecordPage>;
  filterOptions(input: { ownerId: string }): Promise<RecordFilterOptions>;
  findResource(input: {
    ownerId: string;
    readableId: string;
  }): Promise<(StoredRecord & { backlinks: KnowledgePageSummary[] }) | null>;
}
export type RecordPublication = { result: RecordWriteResult; committed: boolean };
function recordSummaryFrom(
  record: Omit<RecordSummary, 'source'> & {
    provider: string;
    kind: string;
    sourceId: string;
    sourceUrl: string | null;
  },
): RecordSummary {
  return {
    readableId: record.readableId,
    title: record.title,
    source: {
      provider: record.provider,
      kind: record.kind,
      id: record.sourceId,
      url: record.sourceUrl,
    },
    occurredAt: record.occurredAt,
    sourceCreatedAt: record.sourceCreatedAt,
    sourceUpdatedAt: record.sourceUpdatedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function existingWriteState({
  current,
  input,
}: {
  current: Queries['FindCurrentRecord'] | undefined;
  input: WriteRecordInput;
}): 'unchanged' | 'stale' | 'conflict' | null {
  if (!current) {
    return null;
  }
  if (input.sync) {
    return syncedWriteState({ current, input });
  }
  const sourceUpdatedAt = input.value?.record.sourceUpdatedAt ?? input.deletion?.sourceUpdatedAt;
  if (input.value && !current.deletedAt && current.contentHash === input.value.contentHash) {
    return 'unchanged';
  }
  if (input.deletion && current.deletedAt && sourceUpdatedAt === current.sourceUpdatedAt) {
    return 'unchanged';
  }
  // Arrival order is not a version: changed data needs a newer source timestamp.
  if (!sourceUpdatedAt || !current.sourceUpdatedAt) {
    return 'conflict';
  }
  if (sourceUpdatedAt < current.sourceUpdatedAt) {
    return 'stale';
  }
  return sourceUpdatedAt === current.sourceUpdatedAt ? 'conflict' : null;
}

function syncedWriteState(input: {
  current: Queries['FindCurrentRecord'];
  input: WriteRecordInput;
}) {
  const revision = input.input.sync!.revision;
  if (revision < input.current.syncRevision) {
    return 'stale';
  }
  if (input.current.contentHash === input.input.value?.contentHash) {
    return 'unchanged';
  }
  return revision === input.current.syncRevision ? 'conflict' : null;
}

async function advanceSyncRevision(input: {
  db: TypedSQL<Queries>;
  write: WriteRecordInput;
  current: Queries['FindCurrentRecord'];
}) {
  if (input.write.sync && input.write.sync.revision > input.current.syncRevision) {
    await input.db.AdvanceRecordSyncRevision`
      update "record" set "sync_revision" = ${input.write.sync.revision}
      where "owner_id" = ${input.write.ownerId} and "readable_id" = ${input.current.readableId}
    `;
  }
}

const RECORD_HISTORY_EXCERPT_LENGTH = 280;

async function recordPublicationChange({
  db,
  input,
  current,
  readableId,
  excerpt,
}: {
  db: TypedSQL<Queries>;
  input: WriteRecordInput;
  current: Queries['FindCurrentRecord'] | undefined;
  readableId: string;
  excerpt: string | undefined;
}) {
  const record = input.value?.record;
  if (!record) {
    if (!current || current.deletedAt) {
      return;
    }
    await recordChange({
      db,
      ownerId: input.ownerId,
      change: input.change,
      resourceType: 'record',
      readableId,
      name: current.title ?? `${input.deletion!.source.provider} ${input.deletion!.source.kind}`,
      action: 'deleted',
      details: [`Removed by ${input.deletion!.source.provider}`],
      createdAt: input.receivedAt,
    });
    return;
  }
  const details = [`${record.source.provider} · ${record.source.kind}`];
  if (current) {
    details.push(...changedText({ label: 'Title', before: current.title, after: record.title }));
    details.push('Source content or metadata updated');
  }
  if (excerpt) {
    details.push(excerpt.slice(0, RECORD_HISTORY_EXCERPT_LENGTH));
  }
  await recordChange({
    db,
    ownerId: input.ownerId,
    change: input.change,
    resourceType: 'record',
    readableId,
    name: record.title,
    action: current && !current.deletedAt ? 'updated' : 'created',
    details,
    createdAt: input.receivedAt,
  });
}

async function publishRecord({
  db,
  input,
  readableId,
}: {
  db: TypedSQL<Queries>;
  input: WriteRecordInput;
  readableId: string;
}) {
  const record = input.value?.record;
  const source = (record ?? input.deletion!).source;
  const sourceUpdatedAt = (record ?? input.deletion!).sourceUpdatedAt;
  const sync = input.sync ?? { syncId: '', revision: 0 };
  await db.WriteRecord`
    insert into "record" ("owner_id", "sync_id", "sync_revision", "readable_id", "provider", "kind", "source_id", "source_url", "title", "occurred_at",
      "source_created_at", "source_updated_at", "deleted_at", "storage_key", "content_hash", "size_bytes", "created_at", "updated_at")
    values (${input.ownerId}, ${sync.syncId}, ${sync.revision}, ${readableId}, ${source.provider}, ${source.kind}, ${source.id}, ${record?.source.url ?? null},
      ${record?.title ?? null}, ${record?.occurredAt ?? null}, ${record?.sourceCreatedAt ?? null}, ${sourceUpdatedAt},
      ${input.deletion ? input.receivedAt : null}, ${input.value?.storageKey ?? null}, ${input.value?.contentHash ?? null},
      ${input.value?.sizeBytes ?? null}, ${input.receivedAt}, ${input.receivedAt})
    on conflict ("owner_id", "sync_id", "provider", "kind", "source_id") do update set
      "sync_revision" = excluded."sync_revision", "source_url" = excluded."source_url", "title" = excluded."title", "occurred_at" = excluded."occurred_at",
      "source_created_at" = excluded."source_created_at", "source_updated_at" = excluded."source_updated_at",
      "deleted_at" = excluded."deleted_at", "storage_key" = excluded."storage_key", "content_hash" = excluded."content_hash",
      "size_bytes" = excluded."size_bytes", "updated_at" = excluded."updated_at"
  `;
}

async function replaceRecordAssetUsages(input: {
  db: TypedSQL<Queries>;
  write: WriteRecordInput;
  readableId: string;
}) {
  const { db, write, readableId } = input;
  await db.RemoveRecordAssetUsages`
    delete from "record_asset_usage" where "owner_id" = ${write.ownerId} and "record_readable_id" = ${readableId}
  `;
  for (const usage of write.value?.assetUsages ?? []) {
    const rows = await db.AddRecordAssetUsage`
      insert into "record_asset_usage" ("owner_id", "record_readable_id", "asset_id", "presentation")
      select ${write.ownerId}, ${readableId}, "id", ${usage.presentation} from "asset"
      where "owner_id" = ${write.ownerId} and "readable_id" = ${usage.readableId} and "archived_at" is null
      returning "asset_id" as "assetId"
    `;
    if (!rows.length) {
      throw new InvalidRecordAssetError();
    }
  }
}

async function writeRecord({
  db,
  input,
}: {
  db: TypedSQL<Queries>;
  input: WriteRecordInput;
}): Promise<RecordPublication> {
  const record = input.value?.record;
  const source = (record ?? input.deletion!).source;
  const sync = input.sync ?? { syncId: '', revision: 0 };
  const rows = await db.FindCurrentRecord`
    /* @notNull syncRevision */
    select "readable_id" as "readableId", "title", "source_updated_at" as "sourceUpdatedAt",
      "content_hash" as "contentHash", "deleted_at" as "deletedAt", "sync_revision" as "syncRevision"
    from "record" where "owner_id" = ${input.ownerId} and "provider" = ${source.provider}
      and "kind" = ${source.kind} and "source_id" = ${source.id} and "sync_id" = ${sync.syncId}
  `;
  const current = rows[0];
  const readableId = current?.readableId ?? input.readableId;
  const skipped = (state: RecordWriteResult['state']): RecordPublication => ({
    result: { state, readableId },
    committed: false,
  });
  const skip = existingWriteState({ current, input });
  if (skip) {
    if (skip === 'unchanged') {
      await advanceSyncRevision({ db, write: input, current: current! });
    }
    return skipped(skip);
  }
  await publishRecord({ db, input, readableId });
  await replaceRecordAssetUsages({ db, write: input, readableId });
  let excerpt: string | undefined;
  if (record) {
    const text = recordSearchText(record);
    excerpt = text.body;
    await replaceSearchDocument({
      db,
      ownerId: input.ownerId,
      resourceType: 'record',
      readableId,
      label: record.title,
      ...text,
    });
  } else {
    await db.RemoveRecordSearchDocument`
      delete from "hypermedia_search_document" where "owner_id" = ${input.ownerId} and "resource_type" = 'record' and "readable_id" = ${readableId}
    `;
  }
  await recordPublicationChange({ db, input, current, readableId, excerpt });
  return { result: { state: current ? 'updated' : 'created', readableId }, committed: true };
}

export class RecordsRepository implements RecordsRepositoryContract {
  private readonly sql: TypedSQL<Queries>;
  private operationTail: Promise<void> = Promise.resolve();
  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }
  write(input: WriteRecordInput): Promise<RecordPublication> {
    return this.serialize(() => this.sql.begin('immediate', (db) => writeRecord({ db, input })));
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
        /* @notNull readableId title provider kind sourceId createdAt updatedAt */
        select record."readable_id" as "readableId", record."title", record."provider", record."kind",
          record."source_id" as "sourceId", record."source_created_at" as "sourceCreatedAt",
          record."source_updated_at" as "sourceUpdatedAt",
          record."source_url" as "sourceUrl", record."occurred_at" as "occurredAt",
          record."created_at" as "createdAt", record."updated_at" as "updatedAt"
        from "record" record
        where record."owner_id" = ${ownerId} and record."deleted_at" is null
          and (${provider ?? null} is null or record."provider" = ${provider ?? null})
          and (${kind ?? null} is null or record."kind" = ${kind ?? null})
          and (${createdFrom ?? null} is null or julianday(record."source_created_at") >= julianday(${createdFrom ?? null}))
          and (${createdTo ?? null} is null or julianday(record."source_created_at") < julianday(${createdTo ?? null}))
          and (${updatedFrom ?? null} is null or julianday(record."source_updated_at") >= julianday(${updatedFrom ?? null}))
          and (${updatedTo ?? null} is null or julianday(record."source_updated_at") < julianday(${updatedTo ?? null}))
        order by
          case ${sortBy} when 'sourceCreatedAt' then julianday(record."source_created_at") is null
            when 'sourceUpdatedAt' then julianday(record."source_updated_at") is null when 'occurredAt' then julianday(record."occurred_at") is null else 0 end,
          case when ${sortDirection} = 'asc' and ${sortBy} = 'sourceCreatedAt' then julianday(record."source_created_at") end asc,
          case when ${sortDirection} = 'asc' and ${sortBy} = 'sourceUpdatedAt' then julianday(record."source_updated_at") end asc,
          case when ${sortDirection} = 'desc' and ${sortBy} = 'sourceCreatedAt' then julianday(record."source_created_at") end desc,
          case when ${sortDirection} = 'desc' and ${sortBy} = 'sourceUpdatedAt' then julianday(record."source_updated_at") end desc,
          case when ${sortDirection} = 'asc' and ${sortBy} = 'occurredAt' then julianday(record."occurred_at") end asc,
          case when ${sortDirection} = 'desc' and ${sortBy} = 'occurredAt' then julianday(record."occurred_at") end desc,
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
      where "owner_id" = ${ownerId} and "deleted_at" is null
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
        /* @notNull title provider readableId kind sourceId storageKey contentHash sizeBytes createdAt updatedAt */
        select record."title", record."provider", record."source_created_at" as "sourceCreatedAt",
          record."source_updated_at" as "sourceUpdatedAt",
          record."source_url" as "sourceUrl", record."occurred_at" as "occurredAt",
          record."readable_id" as "readableId", record."kind", record."source_id" as "sourceId",
          record."storage_key" as "storageKey", record."content_hash" as "contentHash",
          record."size_bytes" as "sizeBytes", record."created_at" as "createdAt",
          record."updated_at" as "updatedAt"
        from "record" record
        where record."owner_id" = ${ownerId} and record."readable_id" = ${readableId}
          and record."deleted_at" is null
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
