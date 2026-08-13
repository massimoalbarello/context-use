import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ReadSourceRecordsInput,
  ReadSourceRecordsResult,
  SourceRecord,
  SourceRecordReader,
} from "../apps/server/src/nango-records.ts";
import { SourceRecordCheckpointError } from "../apps/server/src/nango-records.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DENSE_WINDOW_START, loadAmaraCorpus } from "./corpus-amara.ts";
import type { Corpus, CorpusRecord } from "./corpus-types.ts";
import { loadWorldCorpus } from "./corpus-world.ts";

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

export type { Corpus, CorpusRecord } from "./corpus-types.ts";

export const CORPUS_WINDOWS = ["dense", "full"] as const;
export type CorpusWindow = (typeof CORPUS_WINDOWS)[number];

// Bumped from v1 when the checkpoint's `day` became a corpus-defined `batch`. A
// checkpoint written by the previous format fails the schema and is rejected as invalid
// rather than being read as something it is not.
const CHECKPOINT_PREFIX = "cu-corpus-v2.";
const DEFAULT_RECORD_LIMIT = 50;
const MAX_RECORD_LIMIT = 100;
const DEFAULT_RESPONSE_BYTE_BUDGET = 5_000_000;

const checkpointSchema = z.object({
  version: z.literal(2),
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
  if (existsSync(join(directory, "_ledger.json"))) return loadWorldCorpus(directory);
  throw new Error(`${directory} holds neither a corpus-manifest.json nor a _ledger.json, so its format is unknown.`);
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

function encodeCheckpoint(checkpoint: Checkpoint): string {
  const encoded = Buffer.from(JSON.stringify(checkpoint), "utf8").toString("base64url");
  const checksum = createHash("sha256").update(encoded).digest("hex");
  return `${CHECKPOINT_PREFIX}${encoded}.${checksum}`;
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
  const envelope = value.slice(CHECKPOINT_PREFIX.length);
  const separator = envelope.lastIndexOf(".");
  if (separator < 1) return null;
  const encoded = envelope.slice(0, separator);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const parsed = checkpointSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    return { batch: parsed.batch, index: parsed.index };
  } catch {
    return null;
  }
}

function decodeCheckpoint(corpusId: string, firstBatch: string | null, value?: string): Checkpoint {
  if (!value) return { version: 2, corpus_id: corpusId, batch: firstBatch, index: 0 };
  try {
    if (!value.startsWith(CHECKPOINT_PREFIX) || value.length > 100_000) {
      throw new Error("invalid checkpoint envelope");
    }
    const envelope = value.slice(CHECKPOINT_PREFIX.length);
    const separator = envelope.lastIndexOf(".");
    if (separator < 1 || separator !== envelope.length - 65) {
      throw new Error("invalid checkpoint checksum envelope");
    }
    const encoded = envelope.slice(0, separator);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("invalid checkpoint encoding");
    if (envelope.slice(separator + 1) !== createHash("sha256").update(encoded).digest("hex")) {
      throw new Error("invalid checkpoint checksum");
    }
    const checkpoint = checkpointSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (checkpoint.corpus_id !== corpusId) throw new Error("checkpoint belongs to another corpus");
    return checkpoint;
  } catch {
    throw new SourceRecordCheckpointError();
  }
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
    this.#responseByteBudget = options.responseByteBudget ?? DEFAULT_RESPONSE_BYTE_BUDGET;
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
