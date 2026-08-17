import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  LONGMEMEVAL_DATASET,
  LONGMEMEVAL_DATASET_PATH,
  LONGMEMEVAL_DATASET_URL,
} from "./manifest.ts";

export const LONGMEMEVAL_QUESTION_TYPES = [
  "single-session-user",
  "single-session-assistant",
  "single-session-preference",
  "temporal-reasoning",
  "knowledge-update",
  "multi-session",
] as const;

export type LongMemEvalQuestionType = (typeof LONGMEMEVAL_QUESTION_TYPES)[number];

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  // The pinned cleaned file contains a few empty turns. They carry no facts, but they are
  // still part of the benchmark history and must not make an otherwise valid case unloadable.
  content: z.string(),
}).passthrough();

const caseSchema = z.object({
  question_id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  question_type: z.enum(LONGMEMEVAL_QUESTION_TYPES),
  question: z.string().min(1),
  answer: z.unknown(),
  question_date: z.string().min(1),
  haystack_session_ids: z.array(z.string().min(1)).min(1),
  haystack_dates: z.array(z.string().min(1)).min(1),
  haystack_sessions: z.array(z.array(turnSchema).min(1)).min(1),
  answer_session_ids: z.array(z.string().min(1)),
}).passthrough();

export type LongMemEvalTurn = { role: "user" | "assistant"; content: string };

export type LongMemEvalCase = {
  questionId: string;
  questionType: LongMemEvalQuestionType;
  question: string;
  referenceAnswer: unknown;
  questionDate: string;
  abstention: boolean;
  sessions: Array<{
    id: string;
    date: string;
    turns: LongMemEvalTurn[];
  }>;
  answerSessionIds: string[];
};

export type DatasetSummary = {
  questionId: string;
  questionType: LongMemEvalQuestionType;
  abstention: boolean;
};

export type LongMemEvalSelection = {
  caseId?: string | undefined;
  limit?: number | undefined;
  stratify?: number | undefined;
  all?: boolean | undefined;
};

function rawDataset(path: string): unknown[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a LongMemEval array`);
  return parsed;
}

function readSummary(value: unknown): DatasetSummary {
  const parsed = caseSchema.pick({
    question_id: true,
    question_type: true,
  }).parse(value);
  return {
    questionId: parsed.question_id,
    questionType: parsed.question_type,
    abstention: parsed.question_id.includes("_abs"),
  };
}

export function listLongMemEvalCases(path = LONGMEMEVAL_DATASET_PATH): DatasetSummary[] {
  return rawDataset(path).map(readSummary);
}

function parseCase(value: unknown): LongMemEvalCase {
  if (typeof value !== "object" || value === null || !("answer" in value)) {
    throw new Error("LongMemEval case is missing its reference answer");
  }
  const parsed = caseSchema.parse(value);
  const lengths = [
    parsed.haystack_session_ids.length,
    parsed.haystack_dates.length,
    parsed.haystack_sessions.length,
  ];
  if (!lengths.every((length) => length === lengths[0])) {
    throw new Error(`${parsed.question_id} has mismatched session ids, dates, and bodies`);
  }
  const known = new Set(parsed.haystack_session_ids);
  const foreignAnswer = parsed.answer_session_ids.find((id) => !known.has(id));
  if (foreignAnswer) {
    throw new Error(`${parsed.question_id} names answer session ${foreignAnswer} outside its history`);
  }
  const sessionIdOccurrences = new Map<string, number>();
  return {
    questionId: parsed.question_id,
    questionType: parsed.question_type,
    question: parsed.question,
    referenceAnswer: parsed.answer,
    questionDate: parsed.question_date,
    abstention: parsed.question_id.includes("_abs"),
    sessions: parsed.haystack_sessions.map((turns, index) => {
      const upstreamId = parsed.haystack_session_ids[index]!;
      const occurrence = (sessionIdOccurrences.get(upstreamId) ?? 0) + 1;
      sessionIdOccurrences.set(upstreamId, occurrence);
      return {
        // A few pinned upstream rows repeat a session id. Preserve every history position,
        // but disambiguate its private corpus key so records remain independently countable.
        // The identifier is not rendered to the agent and answer-session labels stay sealed.
        id: occurrence === 1 ? upstreamId : `${upstreamId}--duplicate-${occurrence}`,
        date: parsed.haystack_dates[index]!,
        // Rebuild the turn so `has_answer` and every other upstream label are sealed out.
        turns: turns.map((turn) => ({ role: turn.role, content: turn.content })),
      };
    }),
    answerSessionIds: [...parsed.answer_session_ids],
  };
}

export function readLongMemEvalCases(
  ids: string[],
  path = LONGMEMEVAL_DATASET_PATH,
): LongMemEvalCase[] {
  const wanted = new Set(ids);
  const found = rawDataset(path).flatMap((value) => {
    const summary = readSummary(value);
    return wanted.has(summary.questionId) ? [parseCase(value)] : [];
  });
  const present = new Set(found.map((entry) => entry.questionId));
  const missing = ids.filter((id) => !present.has(id));
  if (missing.length) throw new Error(`Unknown LongMemEval case(s): ${missing.join(", ")}`);
  const byId = new Map(found.map((entry) => [entry.questionId, entry]));
  return ids.map((id) => byId.get(id)!);
}

export function selectAndReadLongMemEvalCases(
  path: string,
  selection: LongMemEvalSelection,
): LongMemEvalCase[] {
  const raw = rawDataset(path);
  const selected = selectLongMemEvalCases(raw.map(readSummary), selection);
  const wanted = new Set(selected.map((entry) => entry.questionId));
  const parsed = raw.flatMap((value) => {
    const summary = readSummary(value);
    return wanted.has(summary.questionId) ? [parseCase(value)] : [];
  });
  const byId = new Map(parsed.map((entry) => [entry.questionId, entry]));
  return selected.map((entry) => byId.get(entry.questionId)!);
}

export function selectLongMemEvalCases(
  summaries: DatasetSummary[],
  selection: LongMemEvalSelection,
): DatasetSummary[] {
  validateLongMemEvalSelection(selection);
  if (selection.caseId) {
    const found = summaries.find((entry) => entry.questionId === selection.caseId);
    if (!found) throw new Error(`Unknown LongMemEval case: ${selection.caseId}`);
    return [found];
  }
  if (selection.limit !== undefined) return summaries.slice(0, selection.limit);
  if (selection.stratify !== undefined) {
    const selectedCases: DatasetSummary[] = [];
    for (const questionType of LONGMEMEVAL_QUESTION_TYPES) {
      selectedCases.push(...summaries.filter((entry) => entry.questionType === questionType)
        .slice(0, selection.stratify));
    }
    return selectedCases;
  }
  return summaries;
}

export function validateLongMemEvalSelection(selection: LongMemEvalSelection): void {
  const selected = [selection.caseId !== undefined, selection.limit !== undefined,
    selection.stratify !== undefined, selection.all === true].filter(Boolean).length;
  if (selected !== 1) {
    throw new Error("Choose exactly one of --case <id>, --limit <n>, --stratify <n>, or --all.");
  }
  if (selection.caseId !== undefined && selection.caseId.length === 0) {
    throw new Error("--case requires a non-empty LongMemEval question id");
  }
  for (const [name, value] of [["--limit", selection.limit], ["--stratify", selection.stratify]] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
}

async function sha256(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

export async function verifyLongMemEvalDataset(path = LONGMEMEVAL_DATASET_PATH): Promise<boolean> {
  if (!existsSync(path)) return false;
  const file = await stat(path);
  return file.size === LONGMEMEVAL_DATASET.bytes
    && await sha256(path) === LONGMEMEVAL_DATASET.sha256;
}

export async function ensureLongMemEvalDataset(options: {
  path?: string;
  fetcher?: typeof fetch;
} = {}): Promise<string> {
  const path = options.path ?? LONGMEMEVAL_DATASET_PATH;
  if (path !== LONGMEMEVAL_DATASET_PATH) {
    if (!await verifyLongMemEvalDataset(path)) {
      throw new Error(`${path} does not match the pinned LongMemEval size and SHA-256`);
    }
    return path;
  }
  if (await verifyLongMemEvalDataset(path)) return path;

  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.download-${randomUUID()}`;
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(LONGMEMEVAL_DATASET_URL);
  // Only `ok`, never `body`: reading `response.body` starts the stream, and the
  // `Bun.write(temporary, response)` below then waits forever on a body it can no longer
  // consume. This guard used to check both and hung every download it was meant to protect.
  if (!response.ok) {
    throw new Error(`LongMemEval download failed with HTTP ${response.status}`);
  }
  try {
    // Streamed to disk chunk by chunk. `Bun.write(path, response)` buffers the whole body
    // first and does not complete for a download this size — it burns CPU without writing a
    // byte, so the fetch looks like a hang rather than a slow network.
    const sink = Bun.file(temporary).writer();
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        sink.write(chunk);
      }
    } finally {
      await sink.end();
    }
    if (!await verifyLongMemEvalDataset(temporary)) {
      throw new Error("Downloaded LongMemEval dataset does not match the pinned size and SHA-256");
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return path;
}
