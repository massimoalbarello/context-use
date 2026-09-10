import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { DeliveredRecord } from '#models/records/delivery-contract.generated.ts';
import type {
  RecordAcceptanceResult,
  RecordPage,
  RecordResource,
  RecordSummary,
} from '#models/records/model.ts';
import type { Queries } from '#queries.gen.ts';

class RecordAcceptanceConflict extends Error {
  constructor() {
    super('A record revision conflicts with stored content');
    this.name = 'RecordAcceptanceConflict';
  }
}

export type AcceptedRecord = {
  record: DeliveredRecord;
  readableId: string;
  markdown: string | null;
};

export type AcceptRecordsInput = {
  syncId: string;
  ownerId: string;
  records: AcceptedRecord[];
  receivedAt: string;
};

export interface RecordsRepositoryContract {
  accept(input: AcceptRecordsInput): Promise<RecordAcceptanceResult>;
  listResources(input: { ownerId: string; limit: number; offset: number }): Promise<RecordPage>;
  findResource(input: { ownerId: string; readableId: string }): Promise<RecordResource | null>;
}

function recordSummaryFrom({
  syncReadableId,
  syncName,
  readableId,
  kind,
  recordId,
  createdAt,
  updatedAt,
}: {
  syncReadableId: string;
  syncName: string;
  readableId: string;
  kind: string;
  recordId: string;
  createdAt: string;
  updatedAt: string;
}): RecordSummary {
  return {
    readableId,
    kind,
    recordId,
    sync: { readableId: syncReadableId, name: syncName },
    createdAt,
    updatedAt,
  };
}

async function applyRecord({
  db,
  input,
  accepted,
}: {
  db: TypedSQL<Queries>;
  input: AcceptRecordsInput;
  accepted: AcceptedRecord;
}): Promise<void> {
  const { record } = accepted;
  const currentRows = await db.FindCurrentRecordRevision`
    /* @notNull revision operation contentHash */
    select "revision", "operation", "content_hash" as "contentHash", "markdown"
    from "record"
    where "sync_id" = ${input.syncId}
      and "source_id" = ${record.sourceId}
      and "kind" = ${record.kind}
      and "record_id" = ${record.id}
  `;
  const current = currentRows[0];
  if (current) {
    const currentRevision = Number(current.revision);
    if (
      currentRevision === record.revision &&
      (current.operation !== record.operation ||
        current.contentHash !== record.contentHash ||
        current.markdown !== accepted.markdown)
    ) {
      throw new RecordAcceptanceConflict();
    }
    if (currentRevision >= record.revision) {
      return;
    }
  }

  await db.ApplyRecordRevision`
    insert into "record"
      ("sync_id", "owner_id", "readable_id", "source_id", "kind", "record_id", "revision",
       "operation", "content_hash", "markdown", "created_at", "updated_at")
    values
      (${input.syncId}, ${input.ownerId}, ${accepted.readableId}, ${record.sourceId}, ${record.kind},
       ${record.id}, ${record.revision}, ${record.operation}, ${record.contentHash},
       ${accepted.markdown}, ${input.receivedAt}, ${input.receivedAt})
    on conflict ("sync_id", "source_id", "kind", "record_id") do update set
      "owner_id" = excluded."owner_id",
      "revision" = excluded."revision",
      "operation" = excluded."operation",
      "content_hash" = excluded."content_hash",
      "markdown" = excluded."markdown",
      "updated_at" = excluded."updated_at"
    where excluded."revision" > "record"."revision"
  `;
}

async function acceptDelivery({
  db,
  input,
}: {
  db: TypedSQL<Queries>;
  input: AcceptRecordsInput;
}): Promise<Exclude<RecordAcceptanceResult, { state: 'conflict' }>> {
  const syncs = await db.FindActiveRecordSyncForAcceptance`
    /* @notNull id ownerId */
    select "id", "owner_id" as "ownerId"
    from "record_sync"
    where "id" = ${input.syncId} and "owner_id" = ${input.ownerId} and "revoked_at" is null
  `;
  if (!syncs[0]) {
    return { state: 'inactive_sync' };
  }

  for (const record of input.records) {
    await applyRecord({ db, input, accepted: record });
  }
  return { state: 'accepted' };
}

export class RecordsRepository implements RecordsRepositoryContract {
  private readonly sql: TypedSQL<Queries>;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async accept(input: AcceptRecordsInput): Promise<RecordAcceptanceResult> {
    try {
      return await this.serialize(() => this.sql.begin((db) => acceptDelivery({ db, input })));
    } catch (error) {
      if (error instanceof RecordAcceptanceConflict) {
        return { state: 'conflict' };
      }
      throw error;
    }
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
    return await this.serialize(async () => {
      const rows = await this.sql.ListRecordResources`
        /* @notNull syncReadableId syncName readableId kind recordId createdAt updatedAt */
        select sync."readable_id" as "syncReadableId", sync."name" as "syncName",
          record."readable_id" as "readableId", record."kind", record."record_id" as "recordId",
          record."created_at" as "createdAt", record."updated_at" as "updatedAt"
        from "record" record
        join "record_sync" sync
          on sync."id" = record."sync_id"
         and sync."owner_id" = record."owner_id"
        where record."owner_id" = ${ownerId} and record."operation" <> 'deleted'
        order by record."updated_at" desc, record."readable_id"
        limit ${limit + 1} offset ${offset}
      `;
      const hasNextPage = rows.length > limit;
      const items = rows.slice(0, limit).map(recordSummaryFrom);
      return { items, nextOffset: hasNextPage ? offset + items.length : null };
    });
  }

  async findResource({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<RecordResource | null> {
    return await this.serialize(async () => {
      const rows = await this.sql.FindRecordResource`
        /* @notNull syncReadableId syncName readableId kind recordId markdown createdAt updatedAt */
        select sync."readable_id" as "syncReadableId", sync."name" as "syncName",
          record."readable_id" as "readableId", record."kind", record."record_id" as "recordId",
          record."markdown", record."created_at" as "createdAt",
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
      return row ? { ...recordSummaryFrom(row), markdown: row.markdown } : null;
    });
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
