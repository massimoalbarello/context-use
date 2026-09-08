import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type {
  OpenConnectorAcceptanceResult,
  OpenConnectorDeliveryRecord,
  OpenConnectorIngestionJob,
  OpenConnectorIntegrationBindingResult,
  OpenConnectorRecordContent,
  OpenConnectorRecordIdentity,
  OpenConnectorSearchResult,
  StoredOpenConnectorRecord,
} from '#models/open-connector/model.ts';
import { MAX_OPEN_CONNECTOR_SEARCH_RESULTS } from '#models/open-connector/model.ts';
import type { Queries } from '#queries.gen.ts';

const MATCH_START = '\u{e000}';
const MATCH_END = '\u{e001}';
const MATCH_ELLIPSIS = ' … ';
const MATCH_EXCERPT_TOKENS = 32;

type OpenConnectorConflictReason = Extract<
  OpenConnectorAcceptanceResult,
  { state: 'conflict' }
>['reason'];

class OpenConnectorAcceptanceConflict extends Error {
  constructor(readonly reason: OpenConnectorConflictReason) {
    super(`Open-connector acceptance conflict: ${reason}`);
    this.name = 'OpenConnectorAcceptanceConflict';
  }
}

export type AcceptedOpenConnectorRecord = {
  record: OpenConnectorDeliveryRecord;
  contentJson: string | null;
  fingerprint: string;
};

export type AcceptOpenConnectorRecordsInput = {
  integrationId: string;
  ownerId: string;
  batchId: string;
  payloadHash: string;
  records: AcceptedOpenConnectorRecord[];
  receivedAt: string;
};

export type OpenConnectorJobProjection = {
  label: string;
  body: string;
};

export type OpenConnectorCredentialVerificationResult =
  | 'initialized'
  | 'verified'
  | 'missing'
  | 'mismatch'
  | 'integration_not_found';

export interface OpenConnectorRecordsRepositoryContract {
  bindIntegration(input: {
    integrationId: string;
    ownerId: string;
    createdAt: string;
  }): Promise<OpenConnectorIntegrationBindingResult>;
  verifyCredentialFingerprint(input: {
    integrationId: string;
    ownerId: string;
    fingerprint: string;
    initializeIfMissing: boolean;
  }): Promise<OpenConnectorCredentialVerificationResult>;
  recordCredentialFingerprint(input: {
    integrationId: string;
    ownerId: string;
    fingerprint: string;
  }): Promise<boolean>;
  accept(input: AcceptOpenConnectorRecordsInput): Promise<OpenConnectorAcceptanceResult>;
  hasUnfinishedJobs(): Promise<boolean>;
  claimJob(input: {
    now: string;
    leaseToken: string;
    leaseExpiresAt: string;
  }): Promise<OpenConnectorIngestionJob | null>;
  completeJob(input: {
    job: OpenConnectorIngestionJob;
    projection: OpenConnectorJobProjection | null;
    completedAt: string;
  }): Promise<'completed' | 'superseded' | 'lost_lease'>;
  retryJob(input: {
    job: OpenConnectorIngestionJob;
    availableAt: string;
    error: string;
    updatedAt: string;
  }): Promise<boolean>;
  find(
    input: OpenConnectorRecordIdentity & { ownerId: string },
  ): Promise<StoredOpenConnectorRecord | null>;
  search(input: {
    ownerId: string;
    query: string;
    limit: number;
  }): Promise<OpenConnectorSearchResult[]>;
}

function contentFrom(serialized: string | null): OpenConnectorRecordContent | null {
  return serialized === null ? null : (JSON.parse(serialized) as OpenConnectorRecordContent);
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

async function bindIntegration({
  db,
  integrationId,
  ownerId,
  createdAt,
}: {
  db: TypedSQL<Queries>;
  integrationId: string;
  ownerId: string;
  createdAt: string;
}): Promise<OpenConnectorIntegrationBindingResult> {
  const owners = await db.FindOpenConnectorOwner`
    /* @notNull id */
    select "id"
    from "auth_user"
    where "id" = ${ownerId}
  `;
  if (!owners[0]) {
    return { state: 'owner_not_found' };
  }

  const inserted = await db.BindOpenConnectorIntegration`
    /* @notNull id ownerId */
    insert into "open_connector_integration" ("id", "owner_id", "created_at")
    values (${integrationId}, ${ownerId}, ${createdAt})
    on conflict ("id") do nothing
    returning "id", "owner_id" as "ownerId"
  `;
  if (inserted[0]) {
    return { state: 'bound' };
  }
  const existing = await db.FindOpenConnectorIntegration`
    /* @notNull id ownerId */
    select "id", "owner_id" as "ownerId"
    from "open_connector_integration"
    where "id" = ${integrationId}
  `;
  return existing[0]?.ownerId === ownerId ? { state: 'already_bound' } : { state: 'conflict' };
}

async function verifyCredentialFingerprint({
  db,
  integrationId,
  ownerId,
  fingerprint,
  initializeIfMissing,
}: {
  db: TypedSQL<Queries>;
  integrationId: string;
  ownerId: string;
  fingerprint: string;
  initializeIfMissing: boolean;
}): Promise<OpenConnectorCredentialVerificationResult> {
  const integrations = await db.FindOpenConnectorCredentialFingerprint`
    /* @notNull id ownerId */
    select "id", "owner_id" as "ownerId",
      "receiver_token_sha256" as "receiverTokenSha256"
    from "open_connector_integration"
    where "id" = ${integrationId}
  `;
  const integration = integrations[0];
  if (!integration || integration.ownerId !== ownerId) {
    return 'integration_not_found';
  }
  if (integration.receiverTokenSha256 === fingerprint) {
    return 'verified';
  }
  if (integration.receiverTokenSha256 !== null) {
    return 'mismatch';
  }
  if (!initializeIfMissing) {
    return 'missing';
  }

  const initialized = await db.InitializeOpenConnectorCredentialFingerprint`
    /* @notNull id */
    update "open_connector_integration"
    set "receiver_token_sha256" = ${fingerprint}
    where "id" = ${integrationId} and "owner_id" = ${ownerId}
      and "receiver_token_sha256" is null
    returning "id"
  `;
  if (initialized[0]) {
    return 'initialized';
  }

  const current = await db.ReadOpenConnectorCredentialFingerprintAfterRace`
    select "receiver_token_sha256" as "receiverTokenSha256"
    from "open_connector_integration"
    where "id" = ${integrationId} and "owner_id" = ${ownerId}
  `;
  return current[0]?.receiverTokenSha256 === fingerprint ? 'verified' : 'mismatch';
}

async function acceptRecord({
  db,
  input,
  accepted,
}: {
  db: TypedSQL<Queries>;
  input: AcceptOpenConnectorRecordsInput;
  accepted: AcceptedOpenConnectorRecord;
}): Promise<void> {
  const { record } = accepted;
  const events = await db.FindOpenConnectorEventFingerprint`
    /* @notNull eventFingerprint */
    select "event_fingerprint" as "eventFingerprint"
    from "open_connector_record_event"
    where "integration_id" = ${input.integrationId} and "event_id" = ${record.eventId}
  `;
  const event = events[0];
  if (event) {
    if (event.eventFingerprint !== accepted.fingerprint) {
      throw new OpenConnectorAcceptanceConflict('event');
    }
    return;
  }

  const revisions = await db.FindOpenConnectorRecordRevisionFingerprints`
    /* @notNull eventFingerprint */
    select "event_fingerprint" as "eventFingerprint"
    from "open_connector_record_event"
    where "integration_id" = ${input.integrationId}
      and "source_id" = ${record.sourceId}
      and "kind" = ${record.kind}
      and "record_id" = ${record.id}
      and "revision" = ${record.revision}
  `;
  if (revisions.some(({ eventFingerprint }) => eventFingerprint !== accepted.fingerprint)) {
    throw new OpenConnectorAcceptanceConflict('record_revision');
  }

  await db.CreateOpenConnectorRecordEvent`
    insert into "open_connector_record_event"
      ("integration_id", "owner_id", "event_id", "batch_id", "provider", "source_id",
       "kind", "record_id", "revision", "operation", "content_hash", "committed_at",
       "content_json", "event_fingerprint", "received_at")
    values
      (${input.integrationId}, ${input.ownerId}, ${record.eventId}, ${input.batchId},
       ${record.provider}, ${record.sourceId}, ${record.kind}, ${record.id}, ${record.revision},
       ${record.operation}, ${record.contentHash}, ${record.committedAt}, ${accepted.contentJson},
       ${accepted.fingerprint}, ${input.receivedAt})
  `;

  const applied = await db.ApplyOpenConnectorRecordRevision`
    /* @notNull revision */
    insert into "open_connector_record"
      ("integration_id", "owner_id", "provider", "source_id", "kind", "record_id",
       "revision", "operation", "content_hash", "committed_at", "content_json",
       "current_event_id", "updated_at")
    values
      (${input.integrationId}, ${input.ownerId}, ${record.provider}, ${record.sourceId},
       ${record.kind}, ${record.id}, ${record.revision}, ${record.operation},
       ${record.contentHash}, ${record.committedAt}, ${accepted.contentJson}, ${record.eventId},
       ${input.receivedAt})
    on conflict ("integration_id", "source_id", "kind", "record_id") do update set
      "owner_id" = excluded."owner_id",
      "provider" = excluded."provider",
      "revision" = excluded."revision",
      "operation" = excluded."operation",
      "content_hash" = excluded."content_hash",
      "committed_at" = excluded."committed_at",
      "content_json" = excluded."content_json",
      "current_event_id" = excluded."current_event_id",
      "updated_at" = excluded."updated_at"
    where excluded."revision" > "open_connector_record"."revision"
    returning "revision"
  `;
  if (!applied[0]) {
    return;
  }

  await db.EnqueueOpenConnectorIngestionJob`
    insert into "open_connector_ingestion_job"
      ("integration_id", "owner_id", "event_id", "source_id", "kind", "record_id",
       "revision", "state", "available_at", "created_at", "updated_at")
    values
      (${input.integrationId}, ${input.ownerId}, ${record.eventId}, ${record.sourceId},
       ${record.kind}, ${record.id}, ${record.revision}, 'pending', ${input.receivedAt},
       ${input.receivedAt}, ${input.receivedAt})
  `;
}

async function acceptDelivery({
  db,
  input,
}: {
  db: TypedSQL<Queries>;
  input: AcceptOpenConnectorRecordsInput;
}): Promise<Exclude<OpenConnectorAcceptanceResult, { state: 'conflict' }>> {
  const integrations = await db.FindOpenConnectorAcceptanceIntegration`
    /* @notNull id ownerId */
    select "id", "owner_id" as "ownerId"
    from "open_connector_integration"
    where "id" = ${input.integrationId}
  `;
  if (integrations[0]?.ownerId !== input.ownerId) {
    throw new OpenConnectorAcceptanceConflict('integration_owner');
  }

  const receipts = await db.FindOpenConnectorBatchReceipt`
    /* @notNull payloadHash */
    select "payload_hash" as "payloadHash"
    from "open_connector_batch_receipt"
    where "integration_id" = ${input.integrationId} and "batch_id" = ${input.batchId}
  `;
  const receipt = receipts[0];
  if (receipt) {
    if (receipt.payloadHash !== input.payloadHash) {
      throw new OpenConnectorAcceptanceConflict('batch');
    }
    return { state: 'duplicate' };
  }

  await db.CreateOpenConnectorBatchReceipt`
    insert into "open_connector_batch_receipt"
      ("integration_id", "owner_id", "batch_id", "payload_hash", "record_count", "received_at")
    values
      (${input.integrationId}, ${input.ownerId}, ${input.batchId}, ${input.payloadHash},
       ${input.records.length}, ${input.receivedAt})
  `;

  for (const accepted of input.records) {
    await acceptRecord({ db, input, accepted });
  }
  return { state: 'accepted' };
}

export class OpenConnectorRecordsRepository implements OpenConnectorRecordsRepositoryContract {
  private readonly sql: TypedSQL<Queries>;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  bindIntegration(input: {
    integrationId: string;
    ownerId: string;
    createdAt: string;
  }): Promise<OpenConnectorIntegrationBindingResult> {
    return this.serialize(() => this.sql.begin((db) => bindIntegration({ db, ...input })));
  }

  verifyCredentialFingerprint({
    integrationId,
    ownerId,
    fingerprint,
    initializeIfMissing,
  }: {
    integrationId: string;
    ownerId: string;
    fingerprint: string;
    initializeIfMissing: boolean;
  }): Promise<OpenConnectorCredentialVerificationResult> {
    return this.serialize(() =>
      this.sql.begin((db) =>
        verifyCredentialFingerprint({
          db,
          integrationId,
          ownerId,
          fingerprint,
          initializeIfMissing,
        }),
      ),
    );
  }

  async recordCredentialFingerprint({
    integrationId,
    ownerId,
    fingerprint,
  }: {
    integrationId: string;
    ownerId: string;
    fingerprint: string;
  }): Promise<boolean> {
    const recorded = await this.serialize(
      () => this.sql.RecordOpenConnectorCredentialFingerprint`
        update "open_connector_integration"
        set "receiver_token_sha256" = ${fingerprint}
        where "id" = ${integrationId} and "owner_id" = ${ownerId}
        returning "id"
      `,
    );
    return recorded.length > 0;
  }

  async accept(input: AcceptOpenConnectorRecordsInput): Promise<OpenConnectorAcceptanceResult> {
    try {
      return await this.serialize(() => this.sql.begin((db) => acceptDelivery({ db, input })));
    } catch (error) {
      if (error instanceof OpenConnectorAcceptanceConflict) {
        return { state: 'conflict', reason: error.reason };
      }
      throw error;
    }
  }

  async hasUnfinishedJobs(): Promise<boolean> {
    const rows = await this.serialize(
      () => this.sql.HasUnfinishedOpenConnectorIngestionJobs`
        /* @notNull unfinished */
        select exists(
          select 1
          from "open_connector_ingestion_job"
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
  }): Promise<OpenConnectorIngestionJob | null> {
    return this.serialize(() =>
      this.sql.begin(async (db) => {
        const claimed = await db.ClaimOpenConnectorIngestionJob`
        /* @notNull integrationId ownerId eventId sourceId kind recordId revision attemptCount leaseToken leaseExpiresAt */
        update "open_connector_ingestion_job"
        set "state" = 'leased', "attempt_count" = "attempt_count" + 1,
          "lease_token" = ${leaseToken}, "lease_expires_at" = ${leaseExpiresAt},
          "last_error" = null, "updated_at" = ${now}
        where ("integration_id", "event_id") = (
          select "integration_id", "event_id"
          from "open_connector_ingestion_job"
          where (
              "state" = 'pending' and "available_at" <= ${now}
            ) or (
              "state" = 'leased' and "lease_expires_at" <= ${now}
            )
          order by "available_at", "created_at", "integration_id", "event_id"
          limit 1
        )
        returning "integration_id" as "integrationId", "owner_id" as "ownerId",
          "event_id" as "eventId", "source_id" as "sourceId", "kind", "record_id" as "recordId",
          "revision", "attempt_count" as "attemptCount", "lease_token" as "leaseToken",
          "lease_expires_at" as "leaseExpiresAt"
      `;
        const job = claimed[0];
        if (!job) {
          return null;
        }
        const events = await db.ReadClaimedOpenConnectorEvent`
        /* @notNull provider operation contentHash committedAt */
        /* @type operation 'added' | 'updated' | 'deleted' */
        select "provider", "operation", "content_hash" as "contentHash",
          "committed_at" as "committedAt", "content_json" as "contentJson"
        from "open_connector_record_event"
        where "integration_id" = ${job.integrationId} and "event_id" = ${job.eventId}
      `;
        const event = events[0];
        if (!event) {
          throw new Error('Claimed open-connector event is missing');
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
    job: OpenConnectorIngestionJob;
    projection: OpenConnectorJobProjection | null;
    completedAt: string;
  }): Promise<'completed' | 'superseded' | 'lost_lease'> {
    return this.serialize(() =>
      this.sql.begin(async (db) => {
        const leases = await db.FindLeasedOpenConnectorIngestionJob`
        /* @notNull revision */
        select "revision"
        from "open_connector_ingestion_job"
        where "integration_id" = ${job.integrationId} and "event_id" = ${job.eventId}
          and "state" = 'leased' and "lease_token" = ${job.leaseToken}
      `;
        if (!leases[0]) {
          return 'lost_lease';
        }
        const currentRows = await db.FindCurrentOpenConnectorRecordForIngestion`
        /* @notNull provider revision operation */
        /* @type operation 'added' | 'updated' | 'deleted' */
        select "provider", "revision", "operation"
        from "open_connector_record"
        where "integration_id" = ${job.integrationId}
          and "source_id" = ${job.sourceId}
          and "kind" = ${job.kind}
          and "record_id" = ${job.recordId}
      `;
        const current = currentRows[0];
        if (!current || Number(current.revision) !== job.revision) {
          await db.SupersedeOpenConnectorIngestionJob`
          update "open_connector_ingestion_job"
          set "state" = 'superseded', "lease_token" = null, "lease_expires_at" = null,
            "updated_at" = ${completedAt}
          where "integration_id" = ${job.integrationId} and "event_id" = ${job.eventId}
            and "state" = 'leased' and "lease_token" = ${job.leaseToken}
        `;
          return 'superseded';
        }

        if (current.operation === 'deleted') {
          await db.DeleteOpenConnectorSearchDocument`
          delete from "open_connector_search_document"
          where "integration_id" = ${job.integrationId}
            and "source_id" = ${job.sourceId}
            and "kind" = ${job.kind}
            and "record_id" = ${job.recordId}
        `;
        } else {
          if (!projection) {
            throw new Error('A current open-connector record requires a search projection');
          }
          await db.UpsertOpenConnectorSearchDocument`
          insert into "open_connector_search_document"
            ("integration_id", "owner_id", "provider", "source_id", "kind", "record_id",
             "revision", "label", "body")
          values
            (${job.integrationId}, ${job.ownerId}, ${current.provider}, ${job.sourceId}, ${job.kind},
             ${job.recordId}, ${job.revision}, ${projection.label}, ${projection.body})
          on conflict ("integration_id", "source_id", "kind", "record_id") do update set
            "owner_id" = excluded."owner_id",
            "provider" = excluded."provider",
            "revision" = excluded."revision",
            "label" = excluded."label",
            "body" = excluded."body"
        `;
        }

        await db.CompleteOpenConnectorIngestionJob`
        update "open_connector_ingestion_job"
        set "state" = 'completed', "lease_token" = null, "lease_expires_at" = null,
          "last_error" = null, "updated_at" = ${completedAt}
        where "integration_id" = ${job.integrationId} and "event_id" = ${job.eventId}
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
    job: OpenConnectorIngestionJob;
    availableAt: string;
    error: string;
    updatedAt: string;
  }): Promise<boolean> {
    const retried = await this.serialize(
      () => this.sql.RetryOpenConnectorIngestionJob`
        update "open_connector_ingestion_job"
        set "state" = 'pending', "available_at" = ${availableAt}, "lease_token" = null,
          "lease_expires_at" = null, "last_error" = ${error}, "updated_at" = ${updatedAt}
        where "integration_id" = ${job.integrationId} and "event_id" = ${job.eventId}
          and "state" = 'leased' and "lease_token" = ${job.leaseToken}
        returning "event_id"
      `,
    );
    return retried.length > 0;
  }

  async find(
    input: OpenConnectorRecordIdentity & { ownerId: string },
  ): Promise<StoredOpenConnectorRecord | null> {
    return await this.serialize(async () => {
      const rows = await this.sql.FindOpenConnectorRecord`
        /* @notNull integrationId ownerId provider sourceId kind recordId revision operation contentHash committedAt currentEventId updatedAt */
        /* @type operation 'added' | 'updated' | 'deleted' */
        select "integration_id" as "integrationId", "owner_id" as "ownerId", "provider",
          "source_id" as "sourceId", "kind", "record_id" as "recordId", "revision", "operation",
          "content_hash" as "contentHash", "committed_at" as "committedAt",
          "content_json" as "contentJson", "current_event_id" as "currentEventId",
          "updated_at" as "updatedAt"
        from "open_connector_record"
        where "integration_id" = ${input.integrationId} and "owner_id" = ${input.ownerId}
          and "source_id" = ${input.sourceId} and "kind" = ${input.kind}
          and "record_id" = ${input.recordId}
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
  }): Promise<OpenConnectorSearchResult[]> {
    return await this.serialize(async () => {
      const expression = ftsQuery(query);
      if (!expression) {
        return [];
      }
      const boundedLimit = Math.min(Math.max(limit, 1), MAX_OPEN_CONNECTOR_SEARCH_RESULTS);
      const rows = await this.sql.SearchOpenConnectorRecords`
        /* @notNull integrationId provider sourceId kind recordId revision contentHash committedAt label rawMatchExcerpt */
        /* @type rawMatchExcerpt string */
        select document."integration_id" as "integrationId", document."provider",
          document."source_id" as "sourceId", document."kind", document."record_id" as "recordId",
          document."revision", current."content_hash" as "contentHash",
          current."committed_at" as "committedAt", document."label",
          snippet("open_connector_search_fts", 5, ${MATCH_START}, ${MATCH_END}, ${MATCH_ELLIPSIS},
            ${MATCH_EXCERPT_TOKENS}) as "rawMatchExcerpt"
        from "open_connector_search_fts"
        join "open_connector_search_document" document
          on document."id" = "open_connector_search_fts"."rowid"
        join "open_connector_record" current
          on current."integration_id" = document."integration_id"
         and current."source_id" = document."source_id"
         and current."kind" = document."kind"
         and current."record_id" = document."record_id"
         and current."owner_id" = document."owner_id"
         and current."revision" = document."revision"
         and current."operation" <> 'deleted'
        where "open_connector_search_fts" match ${expression}
          and document."owner_id" = ${ownerId}
        order by bm25("open_connector_search_fts", 4.0, 3.0, 3.0, 3.0, 2.0, 1.0),
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

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
