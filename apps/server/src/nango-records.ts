import { createHash } from "node:crypto";
import { z } from "zod";
import {
  MANAGED_FUNCTIONS,
  MANAGED_INTEGRATIONS,
} from "../../../nango-integrations/catalog.ts";
import type { SourceRecordWriter } from "@context-use/database";
import { segmentConversationMarkdown } from "./conversation-working-sets.ts";

const connectionSchema = z.object({
  id: z.number().int().positive(),
  connection_id: z.string().min(1),
  provider_config_key: z.string().min(1),
}).passthrough();

const connectionsResponseSchema = z.object({
  connections: z.array(connectionSchema),
}).strict();

const recordMetadataSchema = z.object({
  first_seen_at: z.iso.datetime({ offset: true }),
  last_modified_at: z.iso.datetime({ offset: true }),
  last_action: z.enum(["ADDED", "UPDATED", "DELETED", "added", "updated", "deleted"]),
  deleted_at: z.iso.datetime({ offset: true }).nullable(),
  pruned_at: z.iso.datetime({ offset: true }).nullable(),
  cursor: z.string().min(1).max(1_000),
}).passthrough();

// Nango adds only _nango_metadata to the provider-agnostic pipeline contract.
// Keeping this strict catches a sync that accidentally starts exposing provider JSON.
const activeNangoPipelineRecordSchema = z.object({
  id: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  participants: z.array(z.string().min(1)),
  body: z.string().min(1),
  _nango_metadata: recordMetadataSchema,
}).strict();

// A pruned deletion retains only its stable identity and Nango lifecycle metadata.
// Accepting that tombstone lets the checkpoint advance without treating deleted
// source material as current evidence.
const prunedNangoPipelineRecordSchema = z.object({
  id: z.string().min(1),
  _nango_metadata: recordMetadataSchema,
}).strict();

const nangoPipelineRecordSchema = z.union([
  activeNangoPipelineRecordSchema,
  prunedNangoPipelineRecordSchema,
]);

const recordsResponseSchema = z.object({
  records: z.array(nangoPipelineRecordSchema),
  next_cursor: z.string().min(1).max(1_000).nullable(),
}).strict();

const streamCheckpointSchema = z.object({
  cursor: z.string().min(1).max(1_000).nullable(),
  initial_modified_after: z.iso.datetime({ offset: true }),
}).strict();

const pendingConversationSchema = z.object({
  stream: z.string().regex(/^[a-f0-9]{64}$/),
  record: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  next_segment: z.number().int().min(1),
  continuation_required: z.boolean(),
}).strict();

const checkpointSchema = z.object({
  version: z.literal(1),
  streams: z.record(
    z.string().regex(/^[a-f0-9]{64}$/),
    streamCheckpointSchema,
  ),
  resume_from: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  pending_conversation: pendingConversationSchema.optional(),
}).strict();

const CHECKPOINT_PREFIX = "cu-nango-v1.";
const CONNECTION_PAGE_SIZE = 2_000;
const DEFAULT_RECORD_LIMIT = 50;
const MAX_RECORD_LIMIT = 100;
const DEFAULT_RESPONSE_BYTE_BUDGET = 5_000_000;
const MAX_CHECKPOINT_STREAMS = 1_000;
const RECORD_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1_000;

export type PipelineRecordSource = {
  integrationId: string;
  model: string;
};

export const PIPELINE_RECORD_SOURCES: PipelineRecordSource[] = MANAGED_FUNCTIONS.flatMap(
  (managedFunction) => managedFunction.pipelineModels.map((model) => {
    const integration = MANAGED_INTEGRATIONS.find(
      (candidate) => candidate.id === managedFunction.integrationId,
    );
    if (!integration) {
      throw new Error(`Managed function ${managedFunction.name} has no managed integration`);
    }
    return { integrationId: integration.id, model };
  }),
);

export type SourceRecord = {
  action: "added" | "updated" | "deleted";
  markdown: string | null;
};

export type ReadSourceRecordsInput = {
  checkpoint?: string | undefined;
  limit?: number | undefined;
};

export type ReadSourceRecordsResult = {
  records: SourceRecord[];
  next_checkpoint: string;
  has_more: boolean;
};

export interface SourceRecordReader {
  read(input: ReadSourceRecordsInput): Promise<ReadSourceRecordsResult>;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type NangoRecordReaderOptions = {
  baseUrl: string;
  apiKey: string;
  fetcher?: Fetcher;
  sources?: PipelineRecordSource[];
  responseByteBudget?: number;
  now?: () => Date;
  recordWriter?: SourceRecordWriter;
};

type Checkpoint = z.infer<typeof checkpointSchema>;

type Stream = PipelineRecordSource & {
  connectionInstanceId: number;
  connectionId: string;
  key: string;
};

class NangoRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "NangoRequestError";
  }
}

export class SourceRecordCheckpointError extends Error {
  constructor() {
    super("The source-record checkpoint is invalid. Restore the last successful checkpoint instead of starting over.");
    this.name = "SourceRecordCheckpointError";
  }
}

function streamKey(
  integrationId: string,
  connectionInstanceId: number,
  connectionId: string,
  model: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify([integrationId, connectionInstanceId, connectionId, model]))
    .digest("hex");
}

function encodeCheckpoint(checkpoint: Checkpoint): string {
  const encoded = Buffer.from(JSON.stringify(checkpoint), "utf8").toString("base64url");
  const checksum = createHash("sha256").update(encoded).digest("hex");
  return `${CHECKPOINT_PREFIX}${encoded}.${checksum}`;
}

function decodeCheckpoint(value?: string): Checkpoint {
  if (!value) return { version: 1, streams: {}, resume_from: null };
  try {
    if (!value.startsWith(CHECKPOINT_PREFIX) || value.length > 2_000_000) {
      throw new Error("invalid checkpoint envelope");
    }
    const envelope = value.slice(CHECKPOINT_PREFIX.length);
    const separator = envelope.lastIndexOf(".");
    if (separator < 1 || separator !== envelope.length - 65) {
      throw new Error("invalid checkpoint checksum envelope");
    }
    const encoded = envelope.slice(0, separator);
    const checksum = envelope.slice(separator + 1);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
      throw new Error("invalid checkpoint encoding");
    }
    const expectedChecksum = createHash("sha256").update(encoded).digest("hex");
    if (checksum !== expectedChecksum) throw new Error("invalid checkpoint checksum");
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const checkpoint = checkpointSchema.parse(parsed);
    if (Object.keys(checkpoint.streams).length > MAX_CHECKPOINT_STREAMS) {
      throw new Error("too many checkpoint streams");
    }
    return checkpoint;
  } catch {
    throw new SourceRecordCheckpointError();
  }
}

type NangoPipelineRecord = z.infer<typeof nangoPipelineRecordSchema>;

function recordIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function lifecycleRecord(sourceRecord: NangoPipelineRecord): SourceRecord {
  const action = sourceRecord._nango_metadata.last_action.toLowerCase() as SourceRecord["action"];
  const markdown = "body" in sourceRecord ? sourceRecord.body : null;
  if (action !== "deleted" && markdown === null) {
    throw new Error("Nango returned a pruned non-deleted record");
  }
  return { action, markdown };
}

function recordVersion(sourceRecord: NangoPipelineRecord, record: SourceRecord): string {
  return createHash("sha256").update(JSON.stringify([
    sourceRecord.id,
    sourceRecord._nango_metadata.cursor,
    sourceRecord._nango_metadata.last_modified_at,
    record.action,
    record.markdown,
  ])).digest("hex");
}

function recordRelevantTimestamp(sourceRecord: NangoPipelineRecord, record: SourceRecord): string {
  return record.action === "deleted"
    ? sourceRecord._nango_metadata.last_modified_at
    : "updated_at" in sourceRecord
      ? sourceRecord.updated_at
      : sourceRecord._nango_metadata.last_modified_at;
}

function conversationSegments(model: string, record: SourceRecord): SourceRecord[] {
  if (model !== "AgentConversation" || record.markdown === null) return [record];
  return segmentConversationMarkdown(record.markdown).map(({ markdown }) => ({
    action: record.action,
    markdown,
  }));
}

function rotateFrom<T extends { key: string }>(items: T[], resumeFrom: string | null): T[] {
  if (!resumeFrom) return items;
  const index = items.findIndex(({ key }) => key === resumeFrom);
  return index <= 0 ? items : [...items.slice(index), ...items.slice(0, index)];
}

function responseRecordBytes(record: SourceRecord): number {
  return Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class NangoRecordReader implements SourceRecordReader {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetcher: Fetcher;
  readonly #sources: PipelineRecordSource[];
  readonly #responseByteBudget: number;
  readonly #now: () => Date;
  readonly #recordWriter: SourceRecordWriter | undefined;

  constructor(options: NangoRecordReaderOptions) {
    const baseUrl = new URL(options.baseUrl);
    if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new Error("Nango base URL must not contain credentials, a query, or a fragment");
    }
    if (!options.apiKey) throw new Error("Nango pipeline API key is required");
    this.#baseUrl = baseUrl.toString().replace(/\/$/, "");
    this.#apiKey = options.apiKey;
    this.#fetcher = options.fetcher ?? fetch;
    this.#sources = options.sources ?? PIPELINE_RECORD_SOURCES;
    this.#responseByteBudget = options.responseByteBudget ?? DEFAULT_RESPONSE_BYTE_BUDGET;
    this.#now = options.now ?? (() => new Date());
    this.#recordWriter = options.recordWriter;
    if (!Number.isSafeInteger(this.#responseByteBudget) || this.#responseByteBudget < 1) {
      throw new Error("Response byte budget must be a positive integer");
    }
  }

  async #request(url: URL, headers: Record<string, string> = {}): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.#fetcher(url, {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${this.#apiKey}`,
            ...headers,
          },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) return await response.json();
        const error = new NangoRequestError(
          `Nango ${url.pathname} returned HTTP ${response.status}`,
          response.status === 429 || response.status >= 500,
        );
        if (!error.retryable) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof NangoRequestError && !error.retryable) throw error;
        lastError = error;
      }
      if (attempt < 2) await pause(100 * 2 ** attempt);
    }
    throw lastError instanceof Error ? lastError : new Error("Nango request failed");
  }

  async #connections(integrationId: string): Promise<Array<z.infer<typeof connectionSchema>>> {
    const connections: Array<z.infer<typeof connectionSchema>> = [];
    for (let page = 0; page < 10_000; page += 1) {
      const url = new URL(`${this.#baseUrl}/connections`);
      url.searchParams.set("integrationId", integrationId);
      url.searchParams.set("limit", String(CONNECTION_PAGE_SIZE));
      url.searchParams.set("page", String(page));
      const response = connectionsResponseSchema.parse(await this.#request(url));
      connections.push(...response.connections.filter(
        (connection) => connection.provider_config_key === integrationId,
      ));
      if (response.connections.length < CONNECTION_PAGE_SIZE) return connections;
    }
    throw new Error(`Nango connection pagination did not terminate for ${integrationId}`);
  }

  async #streams(): Promise<Stream[]> {
    const sourcesByIntegration = new Map<string, PipelineRecordSource[]>();
    for (const source of this.#sources) {
      const current = sourcesByIntegration.get(source.integrationId) ?? [];
      current.push(source);
      sourcesByIntegration.set(source.integrationId, current);
    }
    const connectionGroups = await Promise.all(
      [...sourcesByIntegration.keys()].sort().map(async (integrationId) => ({
        integrationId,
        connections: await this.#connections(integrationId),
      })),
    );
    return connectionGroups.flatMap(({ integrationId, connections }) => {
      const sources = sourcesByIntegration.get(integrationId) ?? [];
      return connections.flatMap((connection) => sources.map((source) => ({
        ...source,
        connectionInstanceId: connection.id,
        connectionId: connection.connection_id,
        key: streamKey(integrationId, connection.id, connection.connection_id, source.model),
      })));
    }).sort((left, right) => left.key.localeCompare(right.key));
  }

  async #records(stream: Stream, checkpoint: z.infer<typeof streamCheckpointSchema>, limit: number) {
    const url = new URL(`${this.#baseUrl}/records`);
    url.searchParams.set("model", stream.model);
    url.searchParams.set("limit", String(limit));
    if (checkpoint.cursor) {
      url.searchParams.set("cursor", checkpoint.cursor);
    } else {
      url.searchParams.set("modified_after", checkpoint.initial_modified_after);
    }
    return recordsResponseSchema.parse(await this.#request(url, {
      "connection-id": stream.connectionId,
      "provider-config-key": stream.integrationId,
    }));
  }

  async #persist(
    stream: Stream,
    sourceRecord: NangoPipelineRecord,
    record: SourceRecord,
  ): Promise<void> {
    await this.#recordWriter?.write({
      integration: stream.integrationId,
      connectionId: stream.connectionId,
      model: stream.model,
      sourceRecordId: sourceRecord.id,
      action: record.action,
      sourceCreatedAt: "created_at" in sourceRecord ? sourceRecord.created_at : null,
      sourceUpdatedAt: recordRelevantTimestamp(sourceRecord, record),
      markdown: record.markdown,
    });
  }

  async read(input: ReadSourceRecordsInput): Promise<ReadSourceRecordsResult> {
    const limit = input.limit ?? DEFAULT_RECORD_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECORD_LIMIT) {
      throw new Error(`Record limit must be between 1 and ${MAX_RECORD_LIMIT}`);
    }
    const prior = decodeCheckpoint(input.checkpoint);
    const discoveredStreams = await this.#streams();
    const now = this.#now();
    if (Number.isNaN(now.getTime())) throw new Error("Source-record freshness clock is invalid");
    const freshnessCutoffMs = now.getTime() - RECORD_FRESHNESS_MS;
    const freshnessCutoff = new Date(freshnessCutoffMs).toISOString();
    const streamCheckpoints: Checkpoint["streams"] = {};
    for (const stream of discoveredStreams) {
      streamCheckpoints[stream.key] = {
        cursor: prior.streams[stream.key]?.cursor ?? null,
        initial_modified_after: freshnessCutoff,
      };
    }

    // A segmented conversation deliberately leaves the upstream cursor before its logical
    // record. Each fresh automation run re-reads that record, verifies the version, and
    // advances only one ordered excerpt. If the source changed meanwhile, restart from the
    // first excerpt of the newer version so no part of the current record is skipped.
    if (prior.pending_conversation) {
      const pending = prior.pending_conversation;
      const stream = discoveredStreams.find(({ key }) => key === pending.stream);
      if (!stream) throw new SourceRecordCheckpointError();
      const streamCheckpoint = streamCheckpoints[stream.key]!;
      const page = await this.#records(stream, streamCheckpoint, MAX_RECORD_LIMIT);
      const sourceRecord = page.records.find(({ id }) => recordIdentity(id) === pending.record);
      if (!sourceRecord) {
        throw new Error("The pending conversation source version is no longer available; retry after it is synced again.");
      }
      const record = lifecycleRecord(sourceRecord);
      const version = recordVersion(sourceRecord, record);
      const segments = conversationSegments(stream.model, record);
      const segmentIndex = version === pending.version ? pending.next_segment : 0;
      const sourceIndex = page.records.indexOf(sourceRecord);
      const continuationRequired = pending.continuation_required
        || sourceIndex < page.records.length - 1
        || page.next_cursor !== null;
      const segment = segments[segmentIndex] ?? segments[0]!;
      const finished = segmentIndex >= segments.length - 1;
      await this.#persist(stream, sourceRecord, record);
      if (finished) {
        streamCheckpoints[stream.key] = {
          ...streamCheckpoint,
          cursor: sourceRecord._nango_metadata.cursor,
        };
      }
      return {
        records: [segment],
        next_checkpoint: encodeCheckpoint({
          version: 1,
          streams: streamCheckpoints,
          resume_from: finished && !continuationRequired ? null : stream.key,
          ...(finished ? {} : {
            pending_conversation: {
              stream: stream.key,
              record: recordIdentity(sourceRecord.id),
              version,
              next_segment: segmentIndex + 1,
              continuation_required: continuationRequired,
            },
          }),
        }),
        has_more: !finished || continuationRequired,
      };
    }
    const streams = rotateFrom(discoveredStreams, prior.resume_from);
    const records: SourceRecord[] = [];
    let responseBytes = 0;
    let hasMore = false;
    let firstStreamWithMore: string | null = null;
    let resumeFrom: string | null = null;

    outer: for (let index = 0; index < streams.length; index += 1) {
      const stream = streams[index]!;
      const remaining = limit - records.length;
      if (remaining === 0) {
        hasMore = true;
        resumeFrom = stream.key;
        break;
      }
      const remainingStreams = streams.length - index;
      const streamLimit = Math.max(1, Math.floor(remaining / remainingStreams));
      const streamCheckpoint = streamCheckpoints[stream.key]!;
      const page = await this.#records(stream, streamCheckpoint, streamLimit);
      for (const sourceRecord of page.records) {
        const record = lifecycleRecord(sourceRecord);
        const relevantTimestamp = recordRelevantTimestamp(sourceRecord, record);
        if (Date.parse(relevantTimestamp) < freshnessCutoffMs) {
          streamCheckpoints[stream.key] = {
            ...streamCheckpoint,
            cursor: sourceRecord._nango_metadata.cursor,
          };
          continue;
        }
        const segments = conversationSegments(stream.model, record);
        if (segments.length > 1) {
          // A conversation excerpt is always its own working set. If this response already
          // holds smaller records, stop immediately before it and resume from their cursor.
          if (records.length > 0) {
            hasMore = true;
            resumeFrom = stream.key;
            break outer;
          }
          await this.#persist(stream, sourceRecord, record);
          return {
            records: [segments[0]!],
            next_checkpoint: encodeCheckpoint({
              version: 1,
              streams: streamCheckpoints,
              resume_from: stream.key,
              pending_conversation: {
                stream: stream.key,
                record: recordIdentity(sourceRecord.id),
                version: recordVersion(sourceRecord, record),
                next_segment: 1,
                continuation_required: page.records.indexOf(sourceRecord) < page.records.length - 1
                  || page.next_cursor !== null
                  || index < streams.length - 1,
              },
            }),
            has_more: true,
          };
        }
        const bytes = responseRecordBytes(record);
        if (records.length > 0 && responseBytes + bytes > this.#responseByteBudget) {
          hasMore = true;
          resumeFrom = stream.key;
          break outer;
        }
        await this.#persist(stream, sourceRecord, record);
        records.push(record);
        responseBytes += bytes;
        streamCheckpoints[stream.key] = {
          ...streamCheckpoint,
          cursor: sourceRecord._nango_metadata.cursor,
        };
      }
      if (page.next_cursor) {
        hasMore = true;
        firstStreamWithMore ??= stream.key;
      }
    }

    if (!resumeFrom && hasMore) resumeFrom = firstStreamWithMore;
    return {
      records,
      next_checkpoint: encodeCheckpoint({ version: 1, streams: streamCheckpoints, resume_from: resumeFrom }),
      has_more: hasMore,
    };
  }
}
