import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { RecordAcceptanceResult } from '#models/records/model.ts';
import type { Queries } from '#queries.gen.ts';
import type { AcceptRecordsInput } from './contract.ts';
import type { RecordFileReference } from './files.ts';

class RecordAcceptanceConflict extends Error {}

export type CatalogRecord = RecordFileReference & {
  syncReadableId: string;
  syncName: string;
  createdAt: string;
  updatedAt: string;
};

function catalogRecord(row: Queries['FindRecordResource']): CatalogRecord {
  if (row.operation !== 'added' && row.operation !== 'updated' && row.operation !== 'deleted') {
    throw new Error('Invalid catalog record operation');
  }
  return {
    ...row,
    operation: row.operation,
    revision: Number(row.revision),
    sizeBytes: Number(row.sizeBytes),
  };
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
  file: RecordFileReference;
  publishedKeys: Set<string>;
}): Promise<void> {
  const rows = await db.FindCurrentRecordRevision`
    /* @notNull revision revisionHash readableId storageKey */
    select "revision", "revision_hash" as "revisionHash", "readable_id" as "readableId",
      "storage_key" as "storageKey"
    from "record_delivery_head"
    where "owner_id" = ${input.ownerId} and "sync_id" = ${input.syncId}
      and "identity_key" = ${file.identityKey}
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
    insert into "record_delivery_head"
      ("owner_id", "sync_id", "identity_key", "readable_id", "revision", "operation",
       "revision_hash", "storage_key", "blob_hash", "size_bytes", "created_at", "updated_at")
    values
      (${input.ownerId}, ${input.syncId}, ${file.identityKey}, ${file.readableId},
       ${file.revision}, ${file.operation}, ${file.revisionHash}, ${file.storageKey},
       ${file.blobHash}, ${file.sizeBytes}, ${input.receivedAt}, ${input.receivedAt})
    on conflict ("owner_id", "sync_id", "identity_key") do update set
      "revision" = excluded."revision", "operation" = excluded."operation",
      "revision_hash" = excluded."revision_hash", "storage_key" = excluded."storage_key",
      "blob_hash" = excluded."blob_hash", "size_bytes" = excluded."size_bytes",
      "updated_at" = excluded."updated_at"
  `;
  if (current) {
    publishedKeys.delete(current.storageKey);
  }
  publishedKeys.add(file.storageKey);
}

export class RecordCatalog {
  private static readonly operationTails = new WeakMap<SQL, Promise<void>>();
  private readonly connection: SQL;
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.connection = sql;
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
    files: RecordFileReference[];
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

  async list({ ownerId, limit, offset }: { ownerId: string; limit: number; offset: number }) {
    const rows = await this.serialize(
      () => this.sql.ListRecordResources`
      /* @notNull ownerId syncId identityKey readableId revision operation revisionHash storageKey blobHash sizeBytes syncReadableId syncName createdAt updatedAt */
      select head."owner_id" as "ownerId", head."sync_id" as "syncId",
        head."identity_key" as "identityKey", head."readable_id" as "readableId", head."revision",
        head."operation", head."revision_hash" as "revisionHash", head."storage_key" as "storageKey",
        head."blob_hash" as "blobHash", head."size_bytes" as "sizeBytes",
        sync."readable_id" as "syncReadableId", sync."name" as "syncName",
        head."created_at" as "createdAt", head."updated_at" as "updatedAt"
      from "record_delivery_head" head
      join "record_sync" sync on sync."id" = head."sync_id" and sync."owner_id" = head."owner_id"
      where head."owner_id" = ${ownerId} and head."operation" <> 'deleted'
      order by head."updated_at" desc, head."readable_id"
      limit ${limit} offset ${offset}
    `,
    );
    return rows.map(catalogRecord);
  }

  async find({ ownerId, readableId }: { ownerId: string; readableId: string }) {
    const rows = await this.serialize(
      () => this.sql.FindRecordResource`
      /* @notNull ownerId syncId identityKey readableId revision operation revisionHash storageKey blobHash sizeBytes syncReadableId syncName createdAt updatedAt */
      select head."owner_id" as "ownerId", head."sync_id" as "syncId",
        head."identity_key" as "identityKey", head."readable_id" as "readableId", head."revision",
        head."operation", head."revision_hash" as "revisionHash", head."storage_key" as "storageKey",
        head."blob_hash" as "blobHash", head."size_bytes" as "sizeBytes",
        sync."readable_id" as "syncReadableId", sync."name" as "syncName",
        head."created_at" as "createdAt", head."updated_at" as "updatedAt"
      from "record_delivery_head" head
      join "record_sync" sync on sync."id" = head."sync_id" and sync."owner_id" = head."owner_id"
      where head."owner_id" = ${ownerId} and head."readable_id" = ${readableId}
        and head."operation" <> 'deleted'
      limit 1
    `,
    );
    return rows[0] ? catalogRecord(rows[0]) : null;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = (RecordCatalog.operationTails.get(this.connection) ?? Promise.resolve()).then(
      operation,
    );
    RecordCatalog.operationTails.set(
      this.connection,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }
}
