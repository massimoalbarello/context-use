import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { DeliveredRecord } from '#models/records/delivery-contract.generated.ts';
import type {
  RecordAcceptanceResult,
  RecordPage,
  RecordSummary,
  StoredRecord,
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

export interface RecordsRepositoryContract {
  accept(input: AcceptRecordsInput): Promise<RecordPublication>;
  listResources(input: { ownerId: string; limit: number; offset: number }): Promise<RecordPage>;
  findResource(input: { ownerId: string; readableId: string }): Promise<StoredRecord | null>;
}

type RecordPublication = {
  result: RecordAcceptanceResult;
  storageKeys: Set<string>;
};

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

  await db.ApplyRecordRevision`
    insert into "record"
      ("sync_id", "owner_id", "readable_id", "source_id", "kind", "record_id", "revision",
       "operation", "revision_hash", "storage_key", "content_hash", "size_bytes", "created_at", "updated_at")
    values
      (${input.syncId}, ${input.ownerId}, ${accepted.readableId}, ${record.sourceId}, ${record.kind},
       ${record.id}, ${record.revision}, ${record.operation}, ${accepted.revisionHash},
       ${accepted.storageKey}, ${accepted.contentHash}, ${accepted.sizeBytes},
       ${input.receivedAt}, ${input.receivedAt})
    on conflict ("owner_id", "sync_id", "source_id", "kind", "record_id") do update set
      "revision" = excluded."revision",
      "operation" = excluded."operation",
      "content_hash" = excluded."content_hash",
      "revision_hash" = excluded."revision_hash",
      "storage_key" = excluded."storage_key",
      "size_bytes" = excluded."size_bytes",
      "updated_at" = excluded."updated_at"
    where excluded."revision" > "record"."revision"
  `;
  if (current) {
    storageKeys.delete(current.storageKey);
  }
  storageKeys.add(accepted.storageKey);
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
  }): Promise<StoredRecord | null> {
    return await this.serialize(async () => {
      const rows = await this.sql.FindRecordResource`
        /* @notNull syncReadableId syncName readableId kind recordId storageKey contentHash sizeBytes createdAt updatedAt */
        select sync."readable_id" as "syncReadableId", sync."name" as "syncName",
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
            storageKey: row.storageKey,
            contentHash: row.contentHash,
            sizeBytes: Number(row.sizeBytes),
          }
        : null;
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
