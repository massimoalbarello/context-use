import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type {
  DeliveredRecord,
  ExternalRecordIdentity,
  RecordAcceptanceResult,
  RecordContent,
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

class RecordAcceptanceConflict extends Error {
  constructor() {
    super('A record revision conflicts with stored content');
    this.name = 'RecordAcceptanceConflict';
  }
}

export type AcceptedRecord = {
  record: DeliveredRecord;
  readableId: string;
  title: string;
  excerpt: string;
  markdown: string | null;
  revisionFingerprint: string;
};

export type AcceptRecordsInput = {
  syncId: string;
  ownerId: string;
  records: AcceptedRecord[];
  receivedAt: string;
};

export interface RecordsRepositoryContract {
  accept(input: AcceptRecordsInput): Promise<RecordAcceptanceResult>;
  find(input: ExternalRecordIdentity & { ownerId: string }): Promise<StoredRecord | null>;
  search(input: { ownerId: string; query: string; limit: number }): Promise<RecordSearchResult[]>;
  listResources(input: { ownerId: string; limit: number; offset: number }): Promise<RecordPage>;
  findResource(input: { ownerId: string; readableId: string }): Promise<RecordResource | null>;
}

function contentFrom(markdown: string | null): RecordContent | null {
  return markdown === null ? null : { body: markdown };
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
    /* @notNull revision revisionFingerprint */
    select "revision", "revision_fingerprint" as "revisionFingerprint"
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
      current.revisionFingerprint !== accepted.revisionFingerprint
    ) {
      throw new RecordAcceptanceConflict();
    }
    if (currentRevision >= record.revision) {
      return;
    }
  }

  await db.ApplyRecordRevision`
    insert into "record"
      ("sync_id", "owner_id", "readable_id", "title", "excerpt", "provider",
       "source_id", "kind", "record_id", "revision", "operation", "content_hash",
       "committed_at", "markdown", "revision_fingerprint", "created_at", "updated_at")
    values
      (${input.syncId}, ${input.ownerId}, ${accepted.readableId}, ${accepted.title},
       ${accepted.excerpt}, ${record.provider}, ${record.sourceId}, ${record.kind}, ${record.id},
       ${record.revision}, ${record.operation}, ${record.contentHash}, ${record.committedAt},
       ${accepted.markdown}, ${accepted.revisionFingerprint}, ${input.receivedAt},
       ${input.receivedAt})
    on conflict ("sync_id", "source_id", "kind", "record_id") do update set
      "owner_id" = excluded."owner_id",
      "title" = excluded."title",
      "excerpt" = excluded."excerpt",
      "provider" = excluded."provider",
      "revision" = excluded."revision",
      "operation" = excluded."operation",
      "content_hash" = excluded."content_hash",
      "committed_at" = excluded."committed_at",
      "markdown" = excluded."markdown",
      "revision_fingerprint" = excluded."revision_fingerprint",
      "updated_at" = excluded."updated_at"
    where excluded."revision" > "record"."revision"
  `;

  if (record.operation === 'deleted') {
    await db.DeleteRecordSearchDocument`
      delete from "record_search_document"
      where "sync_id" = ${input.syncId}
        and "source_id" = ${record.sourceId}
        and "kind" = ${record.kind}
        and "record_id" = ${record.id}
    `;
    return;
  }
  if (accepted.markdown === null) {
    throw new Error('An active record is missing Markdown');
  }
  await db.UpsertRecordSearchDocument`
    insert into "record_search_document"
      ("sync_id", "owner_id", "provider", "source_id", "kind", "record_id", "revision",
       "label", "body")
    values
      (${input.syncId}, ${input.ownerId}, ${record.provider}, ${record.sourceId}, ${record.kind},
       ${record.id}, ${record.revision}, ${accepted.title}, ${accepted.markdown})
    on conflict ("sync_id", "source_id", "kind", "record_id") do update set
      "owner_id" = excluded."owner_id",
      "provider" = excluded."provider",
      "revision" = excluded."revision",
      "label" = excluded."label",
      "body" = excluded."body"
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
        return { state: 'conflict', reason: 'record_revision' };
      }
      throw error;
    }
  }

  async find(input: ExternalRecordIdentity & { ownerId: string }): Promise<StoredRecord | null> {
    return await this.serialize(async () => {
      const rows = await this.sql.FindRecord`
        /* @notNull syncId syncReadableId ownerId readableId provider sourceId kind recordId revision operation contentHash committedAt createdAt updatedAt */
        /* @type operation 'added' | 'updated' | 'deleted' */
        select record."sync_id" as "syncId", sync."readable_id" as "syncReadableId",
          record."owner_id" as "ownerId", record."readable_id" as "readableId",
          record."provider", record."source_id" as "sourceId", record."kind",
          record."record_id" as "recordId", record."revision", record."operation",
          record."content_hash" as "contentHash", record."committed_at" as "committedAt",
          record."markdown", record."created_at" as "createdAt",
          record."updated_at" as "updatedAt"
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
            content: contentFrom(row.markdown),
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
          document."provider", document."source_id" as "sourceId", document."kind",
          document."record_id" as "recordId", document."revision",
          current."content_hash" as "contentHash", current."committed_at" as "committedAt",
          document."label",
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
        /* @notNull syncReadableId syncName readableId title excerpt markdown createdAt updatedAt */
        select sync."readable_id" as "syncReadableId", sync."name" as "syncName",
          record."readable_id" as "readableId", record."title", record."excerpt",
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
