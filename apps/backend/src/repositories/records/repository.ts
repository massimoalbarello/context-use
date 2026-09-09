import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type {
  DeliveredRecord,
  ExternalRecordIdentity,
  RecordAcceptanceResult,
  RecordContent,
  RecordIngestionJob,
  RecordPage,
  RecordResource,
  RecordSearchResult,
  RecordSummary,
  StoredRecord,
} from '#models/records/model.ts';
import { MAX_RECORD_SEARCH_RESULTS } from '#models/records/model.ts';
import type { Queries } from '#queries.gen.ts';

const MATCH_START = '\u{e000}';
const MATCH_END = '\u{e001}';
const MATCH_ELLIPSIS = ' … ';
const MATCH_EXCERPT_TOKENS = 32;

type RecordConflictReason = Extract<RecordAcceptanceResult, { state: 'conflict' }>['reason'];

class RecordAcceptanceConflict extends Error {
  constructor(readonly reason: RecordConflictReason) {
    super(`Record delivery acceptance conflict: ${reason}`);
    this.name = 'RecordAcceptanceConflict';
  }
}

export type AcceptedRecord = {
  record: DeliveredRecord;
  readableId: string;
  title: string;
  excerpt: string;
  contentJson: string | null;
  fingerprint: string;
};

export type AcceptRecordsInput = {
  syncId: string;
  ownerId: string;
  batchId: string;
  payloadHash: string;
  records: AcceptedRecord[];
  receivedAt: string;
};

export type RecordJobProjection = {
  label: string;
  body: string;
};

export interface RecordsRepositoryContract {
  accept(input: AcceptRecordsInput): Promise<RecordAcceptanceResult>;
  hasUnfinishedJobs(): Promise<boolean>;
  claimJob(input: {
    now: string;
    leaseToken: string;
    leaseExpiresAt: string;
  }): Promise<RecordIngestionJob | null>;
  completeJob(input: {
    job: RecordIngestionJob;
    projection: RecordJobProjection | null;
    completedAt: string;
  }): Promise<'completed' | 'superseded' | 'lost_lease'>;
  retryJob(input: {
    job: RecordIngestionJob;
    availableAt: string;
    error: string;
    updatedAt: string;
  }): Promise<boolean>;
  find(input: ExternalRecordIdentity & { ownerId: string }): Promise<StoredRecord | null>;
  search(input: { ownerId: string; query: string; limit: number }): Promise<RecordSearchResult[]>;
  listResources(input: { ownerId: string; limit: number; offset: number }): Promise<RecordPage>;
  findResource(input: { ownerId: string; readableId: string }): Promise<RecordResource | null>;
}

function contentFrom(serialized: string | null): RecordContent | null {
  return serialized === null ? null : (JSON.parse(serialized) as RecordContent);
}

function queryTokens(query: string): string[] {
  return [...query.matchAll(/[\p{L}\p{N}]+/gu)].map(([token]) => token.toLowerCase());
}

function ftsQuery(query: string): string | null {
  const tokens = [...new Set(queryTokens(query))];
  return tokens.length > 0 ? tokens.map((token) => `"${token}"*`).join(' OR ') : null;
}

function matchExcerpt(raw: string | null): string | null {
  if (!raw?.includes(MATCH_START)) {
    return null;
  }
  return raw.replaceAll(MATCH_START, '').replaceAll(MATCH_END, '').trim();
}

function recordSummaryFrom({
  syncReadableId,
  syncName,
  readableId,
  title,
  excerpt,
  createdAt,
  updatedAt,
}: {
  syncReadableId: string;
  syncName: string;
  readableId: string;
  title: string;
  excerpt: string;
  createdAt: string;
  updatedAt: string;
}): RecordSummary {
  return {
    readableId,
    title,
    excerpt,
    sync: { readableId: syncReadableId, name: syncName },
    createdAt,
    updatedAt,
  };
}

async function acceptRecord({
  db,
  input,
  accepted,
}: {
  db: TypedSQL<Queries>;
  input: AcceptRecordsInput;
  accepted: AcceptedRecord;
}): Promise<void> {
  const { record } = accepted;
  const events = await db.FindRecordEventFingerprint`
    /* @notNull eventFingerprint */
    select "event_fingerprint" as "eventFingerprint"
    from "record_event"
    where "sync_id" = ${input.syncId} and "event_id" = ${record.eventId}
  `;
  const event = events[0];
  if (event) {
    if (event.eventFingerprint !== accepted.fingerprint) {
      throw new RecordAcceptanceConflict('event');
    }
    return;
  }

  const revisions = await db.FindRecordRevisionFingerprints`
    /* @notNull eventFingerprint */
    select "event_fingerprint" as "eventFingerprint"
    from "record_event"
    where "sync_id" = ${input.syncId}
      and "source_id" = ${record.sourceId}
      and "kind" = ${record.kind}
      and "record_id" = ${record.id}
      and "revision" = ${record.revision}
  `;
  if (revisions.some(({ eventFingerprint }) => eventFingerprint !== accepted.fingerprint)) {
    throw new RecordAcceptanceConflict('record_revision');
  }

  await db.CreateRecordEvent`
    insert into "record_event"
      ("sync_id", "owner_id", "event_id", "batch_id", "provider", "source_id",
       "kind", "record_id", "revision", "operation", "content_hash", "committed_at",
       "content_json", "event_fingerprint", "received_at")
    values
      (${input.syncId}, ${input.ownerId}, ${record.eventId}, ${input.batchId},
       ${record.provider}, ${record.sourceId}, ${record.kind}, ${record.id}, ${record.revision},
       ${record.operation}, ${record.contentHash}, ${record.committedAt}, ${accepted.contentJson},
       ${accepted.fingerprint}, ${input.receivedAt})
  `;

  const applied = await db.ApplyRecordRevision`
    /* @notNull revision */
    insert into "record"
      ("sync_id", "owner_id", "readable_id", "title", "excerpt", "provider",
       "source_id", "kind", "record_id",
       "revision", "operation", "content_hash", "committed_at", "content_json",
       "current_event_id", "created_at", "updated_at")
    values
      (${input.syncId}, ${input.ownerId}, ${accepted.readableId}, ${accepted.title},
       ${accepted.excerpt}, ${record.provider}, ${record.sourceId}, ${record.kind}, ${record.id},
       ${record.revision}, ${record.operation},
       ${record.contentHash}, ${record.committedAt}, ${accepted.contentJson}, ${record.eventId},
       ${input.receivedAt}, ${input.receivedAt})
    on conflict ("sync_id", "source_id", "kind", "record_id") do update set
      "owner_id" = excluded."owner_id",
      "title" = excluded."title",
      "excerpt" = excluded."excerpt",
      "provider" = excluded."provider",
      "revision" = excluded."revision",
      "operation" = excluded."operation",
      "content_hash" = excluded."content_hash",
      "committed_at" = excluded."committed_at",
      "content_json" = excluded."content_json",
      "current_event_id" = excluded."current_event_id",
      "updated_at" = excluded."updated_at"
    where excluded."revision" > "record"."revision"
    returning "revision"
  `;
  if (!applied[0]) {
    return;
  }

  await db.EnqueueRecordIngestionJob`
    insert into "record_ingestion_job"
      ("sync_id", "owner_id", "event_id", "source_id", "kind", "record_id",
       "revision", "state", "available_at", "created_at", "updated_at")
    values
      (${input.syncId}, ${input.ownerId}, ${record.eventId}, ${record.sourceId},
       ${record.kind}, ${record.id}, ${record.revision}, 'pending', ${input.receivedAt},
       ${input.receivedAt}, ${input.receivedAt})
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

  const receipts = await db.FindRecordBatchReceipt`
    /* @notNull payloadHash */
    select "payload_hash" as "payloadHash"
    from "record_delivery_batch"
    where "sync_id" = ${input.syncId} and "batch_id" = ${input.batchId}
  `;
  const receipt = receipts[0];
  if (receipt) {
    if (receipt.payloadHash !== input.payloadHash) {
      throw new RecordAcceptanceConflict('batch');
    }
    return { state: 'duplicate' };
  }

  await db.CreateRecordBatchReceipt`
    insert into "record_delivery_batch"
      ("sync_id", "owner_id", "batch_id", "payload_hash", "record_count", "received_at")
    values
      (${input.syncId}, ${input.ownerId}, ${input.batchId}, ${input.payloadHash},
       ${input.records.length}, ${input.receivedAt})
  `;

  for (const accepted of input.records) {
    await acceptRecord({ db, input, accepted });
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
        return { state: 'conflict', reason: error.reason };
      }
      throw error;
    }
  }

  async hasUnfinishedJobs(): Promise<boolean> {
    const rows = await this.serialize(
      () => this.sql.HasUnfinishedRecordIngestionJobs`
        /* @notNull unfinished */
        select exists(
          select 1
          from "record_ingestion_job"
          where "state" in ('pending', 'leased')
        ) as "unfinished"
      `,
    );
    return Boolean(rows[0]?.unfinished);
  }

  claimJob({
    now,
    leaseToken,
    leaseExpiresAt,
  }: {
    now: string;
    leaseToken: string;
    leaseExpiresAt: string;
  }): Promise<RecordIngestionJob | null> {
    return this.serialize(() =>
      this.sql.begin(async (db) => {
        const claimed = await db.ClaimRecordIngestionJob`
        /* @notNull syncId ownerId eventId sourceId kind recordId revision attemptCount leaseToken leaseExpiresAt */
        update "record_ingestion_job"
        set "state" = 'leased', "attempt_count" = "attempt_count" + 1,
          "lease_token" = ${leaseToken}, "lease_expires_at" = ${leaseExpiresAt},
          "last_error" = null, "updated_at" = ${now}
        where ("sync_id", "event_id") = (
          select "sync_id", "event_id"
          from "record_ingestion_job"
          where (
              "state" = 'pending' and "available_at" <= ${now}
            ) or (
              "state" = 'leased' and "lease_expires_at" <= ${now}
            )
          order by "available_at", "created_at", "sync_id", "event_id"
          limit 1
        )
        returning "sync_id" as "syncId", "owner_id" as "ownerId",
          "event_id" as "eventId", "source_id" as "sourceId", "kind", "record_id" as "recordId",
          "revision", "attempt_count" as "attemptCount", "lease_token" as "leaseToken",
          "lease_expires_at" as "leaseExpiresAt"
      `;
        const job = claimed[0];
        if (!job) {
          return null;
        }
        const events = await db.ReadClaimedRecordEvent`
        /* @notNull provider operation contentHash committedAt */
        /* @type operation 'added' | 'updated' | 'deleted' */
        select "provider", "operation", "content_hash" as "contentHash",
          "committed_at" as "committedAt", "content_json" as "contentJson"
        from "record_event"
        where "sync_id" = ${job.syncId} and "event_id" = ${job.eventId}
      `;
        const event = events[0];
        if (!event) {
          throw new Error('Claimed record delivery event is missing');
        }
        return {
          ...job,
          revision: Number(job.revision),
          attemptCount: Number(job.attemptCount),
          provider: event.provider,
          operation: event.operation,
          contentHash: event.contentHash,
          committedAt: event.committedAt,
          content: contentFrom(event.contentJson),
        };
      }),
    );
  }

  completeJob({
    job,
    projection,
    completedAt,
  }: {
    job: RecordIngestionJob;
    projection: RecordJobProjection | null;
    completedAt: string;
  }): Promise<'completed' | 'superseded' | 'lost_lease'> {
    return this.serialize(() =>
      this.sql.begin(async (db) => {
        const leases = await db.FindLeasedRecordIngestionJob`
        /* @notNull revision */
        select "revision"
        from "record_ingestion_job"
        where "sync_id" = ${job.syncId} and "event_id" = ${job.eventId}
          and "state" = 'leased' and "lease_token" = ${job.leaseToken}
      `;
        if (!leases[0]) {
          return 'lost_lease';
        }
        const currentRows = await db.FindCurrentRecordForIngestion`
        /* @notNull provider revision operation */
        /* @type operation 'added' | 'updated' | 'deleted' */
        select "provider", "revision", "operation"
        from "record"
        where "sync_id" = ${job.syncId}
          and "source_id" = ${job.sourceId}
          and "kind" = ${job.kind}
          and "record_id" = ${job.recordId}
      `;
        const current = currentRows[0];
        if (!current || Number(current.revision) !== job.revision) {
          await db.SupersedeRecordIngestionJob`
          update "record_ingestion_job"
          set "state" = 'superseded', "lease_token" = null, "lease_expires_at" = null,
            "updated_at" = ${completedAt}
          where "sync_id" = ${job.syncId} and "event_id" = ${job.eventId}
            and "state" = 'leased' and "lease_token" = ${job.leaseToken}
        `;
          return 'superseded';
        }

        if (current.operation === 'deleted') {
          await db.DeleteRecordSearchDocument`
          delete from "record_search_document"
          where "sync_id" = ${job.syncId}
            and "source_id" = ${job.sourceId}
            and "kind" = ${job.kind}
            and "record_id" = ${job.recordId}
        `;
        } else {
          if (!projection) {
            throw new Error('A current record requires a search projection');
          }
          await db.UpsertRecordSearchDocument`
          insert into "record_search_document"
            ("sync_id", "owner_id", "provider", "source_id", "kind", "record_id",
             "revision", "label", "body")
          values
            (${job.syncId}, ${job.ownerId}, ${current.provider}, ${job.sourceId}, ${job.kind},
             ${job.recordId}, ${job.revision}, ${projection.label}, ${projection.body})
          on conflict ("sync_id", "source_id", "kind", "record_id") do update set
            "owner_id" = excluded."owner_id",
            "provider" = excluded."provider",
            "revision" = excluded."revision",
            "label" = excluded."label",
            "body" = excluded."body"
        `;
        }

        await db.CompleteRecordIngestionJob`
        update "record_ingestion_job"
        set "state" = 'completed', "lease_token" = null, "lease_expires_at" = null,
          "last_error" = null, "updated_at" = ${completedAt}
        where "sync_id" = ${job.syncId} and "event_id" = ${job.eventId}
          and "state" = 'leased' and "lease_token" = ${job.leaseToken}
      `;
        return 'completed';
      }),
    );
  }

  async retryJob({
    job,
    availableAt,
    error,
    updatedAt,
  }: {
    job: RecordIngestionJob;
    availableAt: string;
    error: string;
    updatedAt: string;
  }): Promise<boolean> {
    const retried = await this.serialize(
      () => this.sql.RetryRecordIngestionJob`
        update "record_ingestion_job"
        set "state" = 'pending', "available_at" = ${availableAt}, "lease_token" = null,
          "lease_expires_at" = null, "last_error" = ${error}, "updated_at" = ${updatedAt}
        where "sync_id" = ${job.syncId} and "event_id" = ${job.eventId}
          and "state" = 'leased' and "lease_token" = ${job.leaseToken}
        returning "event_id"
      `,
    );
    return retried.length > 0;
  }

  async find(input: ExternalRecordIdentity & { ownerId: string }): Promise<StoredRecord | null> {
    return await this.serialize(async () => {
      const rows = await this.sql.FindRecord`
        /* @notNull syncId syncReadableId ownerId readableId provider sourceId kind recordId revision operation contentHash committedAt currentEventId createdAt updatedAt */
        /* @type operation 'added' | 'updated' | 'deleted' */
        select record."sync_id" as "syncId", sync."readable_id" as "syncReadableId",
          record."owner_id" as "ownerId", record."readable_id" as "readableId",
          record."provider", record."source_id" as "sourceId", record."kind",
          record."record_id" as "recordId", record."revision", record."operation",
          record."content_hash" as "contentHash", record."committed_at" as "committedAt",
          record."content_json" as "contentJson", record."current_event_id" as "currentEventId",
          record."created_at" as "createdAt", record."updated_at" as "updatedAt"
        from "record" record
        join "record_sync" sync
          on sync."id" = record."sync_id" and sync."owner_id" = record."owner_id"
        where record."owner_id" = ${input.ownerId}
          and sync."readable_id" = ${input.syncReadableId}
          and record."source_id" = ${input.sourceId} and record."kind" = ${input.kind}
          and record."record_id" = ${input.recordId}
      `;
      const row = rows[0];
      return row
        ? {
            ...row,
            revision: Number(row.revision),
            content: contentFrom(row.contentJson),
          }
        : null;
    });
  }

  async search({
    ownerId,
    query,
    limit,
  }: {
    ownerId: string;
    query: string;
    limit: number;
  }): Promise<RecordSearchResult[]> {
    return await this.serialize(async () => {
      const expression = ftsQuery(query);
      if (!expression) {
        return [];
      }
      const boundedLimit = Math.min(Math.max(limit, 1), MAX_RECORD_SEARCH_RESULTS);
      const rows = await this.sql.SearchRecords`
        /* @notNull syncReadableId readableId provider sourceId kind recordId revision contentHash committedAt label rawMatchExcerpt */
        /* @type rawMatchExcerpt string */
        select sync."readable_id" as "syncReadableId", current."readable_id" as "readableId",
          document."provider",
          document."source_id" as "sourceId", document."kind", document."record_id" as "recordId",
          document."revision", current."content_hash" as "contentHash",
          current."committed_at" as "committedAt", document."label",
          snippet("record_search_fts", 5, ${MATCH_START}, ${MATCH_END}, ${MATCH_ELLIPSIS},
            ${MATCH_EXCERPT_TOKENS}) as "rawMatchExcerpt"
        from "record_search_fts"
        join "record_search_document" document
          on document."id" = "record_search_fts"."rowid"
        join "record" current
          on current."sync_id" = document."sync_id"
         and current."source_id" = document."source_id"
         and current."kind" = document."kind"
         and current."record_id" = document."record_id"
         and current."owner_id" = document."owner_id"
         and current."revision" = document."revision"
         and current."operation" <> 'deleted'
        join "record_sync" sync
          on sync."id" = document."sync_id" and sync."owner_id" = document."owner_id"
        where "record_search_fts" match ${expression}
          and document."owner_id" = ${ownerId}
        order by bm25("record_search_fts", 4.0, 3.0, 3.0, 3.0, 2.0, 1.0),
          document."kind", document."record_id"
        limit ${boundedLimit}
      `;
      return rows.map(({ rawMatchExcerpt, ...row }) => ({
        ...row,
        revision: Number(row.revision),
        matchExcerpt: matchExcerpt(rawMatchExcerpt),
      }));
    });
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
        /* @notNull syncReadableId syncName readableId title excerpt createdAt updatedAt */
        select sync."readable_id" as "syncReadableId", sync."name" as "syncName",
          record."readable_id" as "readableId", record."title", record."excerpt",
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
        /* @notNull syncReadableId syncName readableId title excerpt contentJson createdAt updatedAt */
        select sync."readable_id" as "syncReadableId", sync."name" as "syncName",
          record."readable_id" as "readableId", record."title", record."excerpt",
          record."content_json" as "contentJson", record."created_at" as "createdAt",
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
      if (!row) {
        return null;
      }
      const content = contentFrom(row.contentJson);
      if (!content) {
        throw new Error('An active record is missing content');
      }
      return { ...recordSummaryFrom(row), markdown: content.body };
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
