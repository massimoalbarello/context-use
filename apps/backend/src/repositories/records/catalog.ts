import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { RecordAcceptanceResult } from '#models/records/model.ts';
import type { Queries } from '#queries.gen.ts';
import type { AcceptRecordsInput, ListRecordsInput } from './contract.ts';
import type { RecordFileReference, StagedRecordFile } from './files.ts';

class RecordAcceptanceConflict extends Error {}

function catalogRecord(row: Queries['FindRecordResource']) {
  if (row.operation !== 'added' && row.operation !== 'updated' && row.operation !== 'deleted') {
    throw new Error('Invalid catalog record operation');
  }
  return {
    ...row,
    operation: row.operation,
    revision: Number(row.revision),
    sizeBytes: Number(row.sizeBytes),
  } satisfies RecordFileReference;
}

async function activeSync({
  db,
  input,
}: {
  db: TypedSQL<Queries>;
  input: Pick<AcceptRecordsInput, 'ownerId' | 'syncId'>;
}): Promise<boolean> {
  const rows = await db.FindActiveRecordSyncForAcceptance`
    select "id" from "record_sync"
    where "id" = ${input.syncId} and "owner_id" = ${input.ownerId} and "revoked_at" is null
  `;
  return rows.length > 0;
}

async function publishRecord({
  db,
  input,
  file,
  publishedKeys,
}: {
  db: TypedSQL<Queries>;
  input: AcceptRecordsInput;
  file: StagedRecordFile;
  publishedKeys: Set<string>;
}): Promise<void> {
  const rows = await db.FindCurrentRecordRevision`
    /* @notNull revision revisionHash readableId storageKey */
    select "revision", "revision_hash" as "revisionHash", "readable_id" as "readableId",
      "storage_key" as "storageKey"
    from "record"
    where "owner_id" = ${input.ownerId} and "sync_id" = ${input.syncId}
      and "source_id" = ${file.sourceId} and "kind" = ${file.kind} and "record_id" = ${file.recordId}
  `;
  const current = rows[0];
  if (current) {
    if (
      current.readableId !== file.readableId ||
      (Number(current.revision) === file.revision && current.revisionHash !== file.revisionHash)
    ) {
      throw new RecordAcceptanceConflict('A record revision conflicts with stored content');
    }
    if (Number(current.revision) >= file.revision) {
      return;
    }
  }
  await db.PublishRecordRevision`
    insert into "record"
      ("owner_id", "sync_id", "source_id", "kind", "record_id", "readable_id", "revision", "operation",
       "revision_hash", "storage_key", "content_hash", "size_bytes", "created_at", "updated_at",
       "provider", "title", "source_created_at", "source_updated_at")
    values
      (${input.ownerId}, ${input.syncId}, ${file.sourceId}, ${file.kind}, ${file.recordId}, ${file.readableId},
       ${file.revision}, ${file.operation}, ${file.revisionHash}, ${file.storageKey},
       ${file.contentHash}, ${file.sizeBytes}, ${input.receivedAt}, ${input.receivedAt},
       ${file.provider}, ${file.title}, ${file.sourceCreatedAt}, ${file.sourceUpdatedAt})
    on conflict ("owner_id", "sync_id", "source_id", "kind", "record_id") do update set
      "revision" = excluded."revision", "operation" = excluded."operation",
      "revision_hash" = excluded."revision_hash", "storage_key" = excluded."storage_key",
      "content_hash" = excluded."content_hash", "size_bytes" = excluded."size_bytes",
      "updated_at" = excluded."updated_at", "provider" = excluded."provider", "title" = excluded."title",
      "source_created_at" = excluded."source_created_at", "source_updated_at" = excluded."source_updated_at"
  `;
  if (current) {
    publishedKeys.delete(current.storageKey);
  }
  publishedKeys.add(file.storageKey);
}

export class RecordCatalog {
  private operationTail: Promise<void> = Promise.resolve();
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  isActive(input: Pick<AcceptRecordsInput, 'ownerId' | 'syncId'>): Promise<boolean> {
    return this.serialize(() => activeSync({ db: this.sql, input }));
  }

  async publish({
    input,
    files,
  }: {
    input: AcceptRecordsInput;
    files: StagedRecordFile[];
  }): Promise<{
    result: RecordAcceptanceResult;
    publishedKeys: Set<string>;
  }> {
    try {
      // Acquire SQLite's write lock before reading revision state, including across connections.
      // All file operations finish before this transaction starts.
      return await this.serialize(() =>
        this.sql.begin('immediate', async (db) => {
          const publishedKeys = new Set<string>();
          if (!(await activeSync({ db, input }))) {
            return { result: { state: 'inactive_sync' }, publishedKeys };
          }
          for (const file of files) {
            await publishRecord({ db, input, file, publishedKeys });
          }
          return { result: { state: 'accepted' }, publishedKeys };
        }),
      );
    } catch (error) {
      if (error instanceof RecordAcceptanceConflict) {
        return { result: { state: 'conflict' }, publishedKeys: new Set() };
      }
      throw error;
    }
  }

  list({
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
  }: ListRecordsInput) {
    return this.serialize(
      () => this.sql.ListRecordResources`
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
        case when ${sortDirection} = 'asc' and ${sortBy} = 'provider' then record."provider" end asc,
        case when ${sortDirection} = 'asc' and ${sortBy} = 'kind' then record."kind" end asc,
        case when ${sortDirection} = 'desc' and ${sortBy} = 'sourceCreatedAt' then julianday(record."source_created_at") end desc,
        case when ${sortDirection} = 'desc' and ${sortBy} = 'sourceUpdatedAt' then julianday(record."source_updated_at") end desc,
        case when ${sortDirection} = 'desc' and ${sortBy} = 'provider' then record."provider" end desc,
        case when ${sortDirection} = 'desc' and ${sortBy} = 'kind' then record."kind" end desc,
      record."readable_id"
      limit ${limit} offset ${offset}
    `,
    );
  }

  async filterOptions(ownerId: string) {
    const rows = await this.serialize(
      () => this.sql.RecordFilterOptions`
      select distinct "provider", "kind" from "record"
      where "owner_id" = ${ownerId} and "operation" <> 'deleted'
      order by "provider", "kind"
    `,
    );
    return {
      providers: [...new Set(rows.map((row) => row.provider))],
      kinds: [...new Set(rows.map((row) => row.kind))].sort(),
    };
  }

  async find({ ownerId, readableId }: { ownerId: string; readableId: string }) {
    const rows = await this.serialize(
      () => this.sql.FindRecordResource`
      /* @notNull title provider ownerId syncId sourceId kind recordId readableId revision operation revisionHash storageKey contentHash sizeBytes syncReadableId syncName createdAt updatedAt */
      select record."title", record."provider", record."source_created_at" as "sourceCreatedAt",
        record."source_updated_at" as "sourceUpdatedAt",
        record."owner_id" as "ownerId", record."sync_id" as "syncId",
        record."source_id" as "sourceId", record."kind", record."record_id" as "recordId",
        record."readable_id" as "readableId", record."revision",
        record."operation", record."revision_hash" as "revisionHash", record."storage_key" as "storageKey",
        record."content_hash" as "contentHash", record."size_bytes" as "sizeBytes",
        sync."readable_id" as "syncReadableId", sync."name" as "syncName",
        record."created_at" as "createdAt", record."updated_at" as "updatedAt"
      from "record" record
      join "record_sync" sync on sync."id" = record."sync_id" and sync."owner_id" = record."owner_id"
      where record."owner_id" = ${ownerId} and record."readable_id" = ${readableId}
        and record."operation" <> 'deleted'
      limit 1
    `,
    );
    return rows[0] ? catalogRecord(rows[0]) : null;
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
