import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ReadSourceRecordsInput,
  ReadSourceRecordsResult,
  SourceRecord,
  SourceRecordReader,
} from "../../../apps/server/src/nango-records.ts";
import { SourceRecordCheckpointError } from "../../../apps/server/src/nango-records.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DENSE_WINDOW_START, loadAmaraCorpus } from "../../data/amara-life-v1/corpus.ts";
import { loadLocomoCaseCorpus } from "../../data/locomo-v1/corpus.ts";
import { loadLongMemEvalCaseCorpus } from "../../data/longmemeval-v1/corpus.ts";
import { loadWorldCorpus } from "../../data/world-v1/corpus.ts";
import {
  CONVERSATION_ITEM_TYPES,
  CONVERSATION_WORKING_SET_BYTE_BUDGET,
  type Corpus,
  type CorpusRecord,
} from "./types.ts";

/**
 * Serves a fixed on-disk corpus through the same `SourceRecordReader` contract the
 * Nango pipeline implements, so knowledge evaluations exercise the production
 * `read_source_records` batch loop instead of a bespoke test path.
 *
 * This file lives outside `apps/server` on purpose. The production image copies only
 * `apps/` and `packages/`, so the evaluation reader is not present in it at all, and
 * `mcp-app.ts` reaches it through a specifier the module graph cannot resolve
 * statically. Development bind-mounts the repository, so it resolves there.
 *
 * One read advances through exactly one corpus batch. `has_more` stays true while that
 * batch still holds records, then the checkpoint moves to the next one. An automation run
 * therefore consumes one batch and stops, the way a scheduled production run consumes
 * whatever a source has produced since its last checkpoint. What a batch means belongs to
 * the corpus — a calendar day for `amara-life-v1`, a slice of the page order for
 * `world-v1` — and nothing here needs to know which.
 *
 * Nango's 30-day freshness window is deliberately absent: it exists because Nango
 * backfills historical records, which a fixed corpus never does. Corpus dates are
 * served exactly as authored.
 */

export type { Corpus, CorpusRecord } from "./types.ts";

export const CORPUS_WINDOWS = ["dense", "full"] as const;
export type CorpusWindow = (typeof CORPUS_WINDOWS)[number];

// Evaluation checkpoints cross an agent boundary twice: the agent saves one and the next
// agent supplies it. Keep that opaque token compact enough to copy reliably. V2 embedded
// the complete corpus id in base64 plus a full checksum; LongMemEval exposed that models
// sometimes reconstructed the payload instead of copying it byte-for-byte. V3 carries the
// batch, index, a corpus fingerprint, and a compact integrity checksum instead.
const CHECKPOINT_PREFIX = "cu-corpus-v3.";
const CHECKPOINT_CORPUS_DIGEST_LENGTH = 12;
const CHECKPOINT_CHECKSUM_LENGTH = 16;
const DEFAULT_RECORD_LIMIT = 50;
const MAX_RECORD_LIMIT = 100;
const DEFAULT_RESPONSE_BYTE_BUDGET = 5_000_000;
// A conversation session — LongMemEval's or LoCoMo's — is much larger than an email or
// calendar record. Both materializers normally close each batch at the same provider-safe
// boundary; the reader enforces it as a second guard. A single exceptionally large session
// is still served atomically.

const checkpointSchema = z.object({
  version: z.literal(3),
  corpus_id: z.string().min(1),
  batch: z.string().min(1).nullable(),
  index: z.number().int().min(0),
}).strict();

type Checkpoint = z.infer<typeof checkpointSchema>;

/**
 * Reads a corpus from disk, in whatever format its upstream ships.
 *
 * The format is detected from the directory's own contents rather than its name, because
 * a corpus is defined by what upstream put in it. Names are the harness's business.
 */
export function loadCorpus(directory: string): Corpus {
  if (existsSync(join(directory, "corpus-manifest.json"))) return loadAmaraCorpus(directory);
  if (existsSync(join(directory, "longmemeval-case.json"))) return loadLongMemEvalCaseCorpus(directory);
  if (existsSync(join(directory, "locomo-case.json"))) return loadLocomoCaseCorpus(directory);
  if (existsSync(join(directory, "_ledger.json"))) return loadWorldCorpus(directory);
  throw new Error(`${directory} holds no recognized corpus descriptor.`);
}

/**
 * Narrows a corpus to the requested window.
 *
 * `dense` selects a span of days, so it means nothing for a corpus with no chronology.
 * Asking for it there fails rather than quietly serving everything: a run that reports a
 * window the server did not apply measures something other than what it claims.
 */
export function windowRecords(corpus: Corpus, window: CorpusWindow): CorpusRecord[] {
  if (window === "full") return corpus.records;
  if (corpus.days.length === 0) {
    throw new Error(`The dense window selects a span of days, and ${corpus.corpusId} has none. Use the full window.`);
  }
  return corpus.records.filter((record) => (record.day ?? "") >= DENSE_WINDOW_START);
}

function checkpointCorpusDigest(corpusId: string): string {
  return createHash("sha256").update(corpusId).digest("hex").slice(0, CHECKPOINT_CORPUS_DIGEST_LENGTH);
}

function checkpointPayload(checkpoint: Checkpoint): string {
  const batch = checkpoint.batch === null
    ? "0"
    : `1${Buffer.from(checkpoint.batch, "utf8").toString("base64url")}`;
  return `${batch}.${checkpoint.index.toString(36)}.${checkpointCorpusDigest(checkpoint.corpus_id)}`;
}

function checkpointChecksum(payload: string): string {
  return createHash("sha256").update(payload).digest("hex").slice(0, CHECKPOINT_CHECKSUM_LENGTH);
}

function encodeCheckpoint(checkpoint: Checkpoint): string {
  const payload = checkpointPayload(checkpoint);
  return `${CHECKPOINT_PREFIX}${payload}.${checkpointChecksum(payload)}`;
}

/**
 * The position a persisted checkpoint points at, for a harness that needs to know whether a
 * run actually finished the batch it was handed rather than stopping partway through it.
 *
 * Lenient on purpose: an absent, malformed or foreign checkpoint returns null, which a
 * caller reads as "no progress recorded" rather than as an error. Deciding whether a batch
 * is done is the caller's business; refusing the read is not.
 */
export function checkpointPosition(value: string | undefined): { batch: string | null; index: number } | null {
  if (!value || !value.startsWith(CHECKPOINT_PREFIX)) return null;
  const parts = value.slice(CHECKPOINT_PREFIX.length).split(".");
  if (parts.length !== 4) return null;
  const [encodedBatch, encodedIndex, corpusDigest, checksum] = parts as [string, string, string, string];
  const payload = `${encodedBatch}.${encodedIndex}.${corpusDigest}`;
  if (!/^(?:0|1[A-Za-z0-9_-]+)$/.test(encodedBatch)
    || !/^[0-9a-z]+$/.test(encodedIndex)
    || !/^[a-f0-9]{12}$/.test(corpusDigest)
    || !/^[a-f0-9]{16}$/.test(checksum)
    || checkpointChecksum(payload) !== checksum) return null;
  try {
    const batch = encodedBatch === "0"
      ? null
      : Buffer.from(encodedBatch.slice(1), "base64url").toString("utf8");
    const index = Number.parseInt(encodedIndex, 36);
    if ((batch !== null && !batch) || !Number.isSafeInteger(index) || index < 0) return null;
    return { batch, index };
  } catch {
    return null;
  }
}

function decodeCheckpoint(corpusId: string, firstBatch: string | null, value?: string): Checkpoint {
  if (!value) return { version: 3, corpus_id: corpusId, batch: firstBatch, index: 0 };
  try {
    if (value.length > 1_000) throw new Error("invalid checkpoint envelope");
    const position = checkpointPosition(value);
    if (!position) throw new Error("invalid checkpoint");
    const parts = value.slice(CHECKPOINT_PREFIX.length).split(".");
    if (parts[2] !== checkpointCorpusDigest(corpusId)) {
      throw new Error("checkpoint belongs to another corpus");
    }
    return checkpointSchema.parse({
      version: 3,
      corpus_id: corpusId,
      batch: position.batch,
      index: position.index,
    });
  } catch {
    throw new SourceRecordCheckpointError();
  }
}

/** Exact checkpoint for a corpus position, used by an eval harness to repair transcription. */
export function corpusCheckpoint(corpusId: string, batch: string | null, index = 0): string {
  return encodeCheckpoint(checkpointSchema.parse({ version: 3, corpus_id: corpusId, batch, index }));
}

type CorpusRecordReaderOptions = {
  directory: string;
  window?: CorpusWindow;
  responseByteBudget?: number;
};

export class CorpusRecordReader implements SourceRecordReader {
  readonly #corpus: Corpus;
  readonly #batches: string[];
  readonly #byBatch: Map<string, CorpusRecord[]>;
  readonly #responseByteBudget: number;

  constructor(options: CorpusRecordReaderOptions) {
    const corpus = loadCorpus(options.directory);
    const records = windowRecords(corpus, options.window ?? "full");
    if (records.length === 0) {
      throw new Error(`Corpus window ${options.window ?? "full"} selected no records`);
    }
    this.#corpus = corpus;
    this.#byBatch = new Map();
    for (const record of records) {
      const batch = this.#byBatch.get(record.batch) ?? [];
      batch.push(record);
      this.#byBatch.set(record.batch, batch);
    }
    // The corpus decides the order of its batches; a window only removes some of them.
    this.#batches = corpus.batches.filter((batch) => this.#byBatch.has(batch));
    this.#responseByteBudget = options.responseByteBudget
      ?? (records.every((record) => CONVERSATION_ITEM_TYPES.has(record.type))
        ? CONVERSATION_WORKING_SET_BYTE_BUDGET
        : DEFAULT_RESPONSE_BYTE_BUDGET);
  }

  /** Every batch this reader will serve, in order, so a harness can drive one run each. */
  get batches(): string[] {
    return [...this.#batches];
  }

  get corpusId(): string {
    return this.#corpus.corpusId;
  }

  #nextBatch(batch: string): string | null {
    const index = this.#batches.indexOf(batch);
    if (index === -1) return this.#batches.find((candidate) => candidate > batch) ?? null;
    return this.#batches[index + 1] ?? null;
  }

  async read(input: ReadSourceRecordsInput): Promise<ReadSourceRecordsResult> {
    const limit = input.limit ?? DEFAULT_RECORD_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECORD_LIMIT) {
      throw new Error(`Record limit must be between 1 and ${MAX_RECORD_LIMIT}`);
    }
    const checkpoint = decodeCheckpoint(this.#corpus.corpusId, this.#batches[0] ?? null, input.checkpoint);
    if (checkpoint.batch === null) {
      return { records: [], next_checkpoint: encodeCheckpoint(checkpoint), has_more: false };
    }

    const batchRecords = this.#byBatch.get(checkpoint.batch) ?? [];
    const records: SourceRecord[] = [];
    let responseBytes = 0;
    let index = checkpoint.index;

    while (index < batchRecords.length && records.length < limit) {
      const record = batchRecords[index]!;
      const source: SourceRecord = {
        action: record.action,
        markdown: record.markdown,
      };
      const bytes = Buffer.byteLength(JSON.stringify(source), "utf8") + 1;
      if (records.length > 0 && responseBytes + bytes > this.#responseByteBudget) break;
      records.push(source);
      responseBytes += bytes;
      index += 1;
    }

    // The batch is the boundary: `has_more` stays true only while this batch has records
    // left, so one automation run consumes exactly one batch.
    const hasMore = index < batchRecords.length;
    const next: Checkpoint = hasMore
      ? { ...checkpoint, index }
      : { ...checkpoint, batch: this.#nextBatch(checkpoint.batch), index: 0 };
    return { records, next_checkpoint: encodeCheckpoint(next), has_more: hasMore };
  }
}
