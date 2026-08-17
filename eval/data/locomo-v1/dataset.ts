import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  LOCOMO_DATASET,
  LOCOMO_DATASET_PATH,
  LOCOMO_DATASET_URL,
} from "./manifest.ts";

/**
 * LoCoMo's five question categories, keyed by the integers the dataset actually carries.
 *
 * The numbers are the benchmark's, and the scorer branches on them: category 1 is scored
 * by splitting a comma-separated answer into sub-answers, category 3 truncates its
 * reference at the first semicolon, and category 5 is not scored against its reference
 * text at all. Naming them here keeps every report readable without inventing an ordering
 * upstream does not use.
 */
export const LOCOMO_CATEGORIES = {
  1: "multi-hop",
  2: "temporal",
  3: "open-domain",
  4: "single-hop",
  5: "adversarial",
} as const;

export const LOCOMO_CATEGORY_NUMBERS = [1, 2, 3, 4, 5] as const;

export type LocomoCategory = (typeof LOCOMO_CATEGORY_NUMBERS)[number];
export type LocomoCategoryName = (typeof LOCOMO_CATEGORIES)[LocomoCategory];

const turnSchema = z.object({
  speaker: z.string().min(1),
  dia_id: z.string().min(1),
  // A handful of image turns carry a caption and no words of their own.
  text: z.string(),
  blip_caption: z.string().optional(),
}).passthrough();

const answerValue = z.union([z.string(), z.number()]);

const questionSchema = z.object({
  question: z.string().min(1),
  answer: answerValue.optional(),
  adversarial_answer: answerValue.optional(),
  evidence: z.array(z.string()).default([]),
  category: z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
  ]),
}).passthrough();

const sampleSchema = z.object({
  sample_id: z.string().min(1),
  conversation: z.record(z.string(), z.unknown()),
  qa: z.array(questionSchema).min(1),
}).passthrough();

export type LocomoTurn = {
  speaker: string;
  diaId: string;
  text: string;
  /** BLIP caption of a shared image, where the turn shared one. */
  imageCaption?: string;
};

export type LocomoSession = {
  /** Upstream's own `session_<n>` index, which is also its chronological position. */
  number: number;
  /** Upstream's date string, verbatim: `1:56 pm on 8 May, 2023`. */
  dateTime: string;
  /** The same instant as an ISO timestamp, for the corpus record's calendar fields. */
  timestamp: string;
  day: string;
  turns: LocomoTurn[];
};

export type LocomoQuestion = {
  /** Upstream ships no question ids, so one is derived from its position: `conv-26-q001`. */
  id: string;
  index: number;
  category: LocomoCategory;
  categoryName: LocomoCategoryName;
  question: string;
  /** Category 5 is answered from `adversarial_answer`; every other category from `answer`. */
  referenceAnswer: string;
  /** Dialogue ids upstream says carry the answer. Nothing scores them — see the README. */
  evidence: string[];
  adversarial: boolean;
};

export type LocomoConversation = {
  sampleId: string;
  speakerA: string;
  speakerB: string;
  sessions: LocomoSession[];
  questions: LocomoQuestion[];
};

export type LocomoConversationSummary = {
  sampleId: string;
  sessions: number;
  turns: number;
  questions: number;
  byCategory: Record<LocomoCategory, number>;
};

export type LocomoSelection = {
  /** Exactly one of these three chooses the conversations. */
  conversationId?: string | undefined;
  limit?: number | undefined;
  all?: boolean | undefined;
  /** At most one of these two narrows the questions inside each chosen conversation. */
  questions?: number | undefined;
  stratify?: number | undefined;
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const DATE_TIME = /^(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/i;

/**
 * Turns `1:56 pm on 8 May, 2023` into calendar fields.
 *
 * Upstream's string is served to the agent verbatim; this is only for the corpus record's
 * `day` and `timestamp`, which is what lets a LoCoMo conversation be read as the time
 * series it is. Every one of the dataset's 288 session dates matches this shape, so a
 * miss is a dataset change rather than a format this should try to guess at.
 */
export function parseLocomoDateTime(value: string): { timestamp: string; day: string } {
  const matched = DATE_TIME.exec(value.trim());
  if (!matched) throw new Error(`Unrecognized LoCoMo session date: ${value}`);
  const [, rawHour, minute, meridiem, day, monthName, year] = matched as unknown as string[];
  const month = MONTHS.indexOf(monthName!.toLowerCase());
  if (month === -1) throw new Error(`Unrecognized month in LoCoMo session date: ${value}`);
  const hour = Number(rawHour) % 12 + (meridiem!.toLowerCase() === "pm" ? 12 : 0);
  const iso = new Date(Date.UTC(
    Number(year), month, Number(day), hour, Number(minute),
  )).toISOString();
  return { timestamp: iso, day: iso.slice(0, 10) };
}

function rawDataset(path: string): unknown[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a LoCoMo array`);
  return parsed;
}

function parseSessions(conversation: Record<string, unknown>): LocomoSession[] {
  const sessions: LocomoSession[] = [];
  for (const [key, value] of Object.entries(conversation)) {
    const numbered = /^session_(\d+)$/.exec(key);
    // Sixteen `session_<n>_date_time` keys in the pinned file have no session body. A date
    // with no turns is not a session, so it is skipped rather than served as an empty one.
    if (!numbered || !Array.isArray(value)) continue;
    const dateTime = conversation[`${key}_date_time`];
    if (typeof dateTime !== "string" || !dateTime.trim()) {
      throw new Error(`LoCoMo ${key} has turns but no session date`);
    }
    const turns = z.array(turnSchema).min(1).parse(value).map((turn) => ({
      speaker: turn.speaker,
      diaId: turn.dia_id,
      text: turn.text,
      ...(turn.blip_caption ? { imageCaption: turn.blip_caption } : {}),
    }));
    sessions.push({
      number: Number(numbered[1]),
      dateTime,
      ...parseLocomoDateTime(dateTime),
      turns,
    });
  }
  // Upstream numbers its sessions chronologically, and the pinned file is monotonic in
  // date under that order. Sorting by number rather than by date keeps the served order
  // upstream's own, so a session never moves because two of them share a day.
  return sessions.sort((left, right) => left.number - right.number);
}

function answerText(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? String(value) : value;
}

function parseQuestions(sampleId: string, raw: z.infer<typeof questionSchema>[]): LocomoQuestion[] {
  return raw.map((entry, index) => {
    const adversarial = entry.category === 5;
    // A-mem's `QA.final_answer`: category 5 is answered from `adversarial_answer`, and two
    // rows in the pinned file carry both fields, so the category decides rather than
    // whichever field happens to be present.
    const reference = answerText(adversarial ? entry.adversarial_answer : entry.answer);
    if (reference === undefined || reference === "") {
      throw new Error(`LoCoMo ${sampleId} question ${index + 1} (category ${entry.category}) has no reference answer`);
    }
    return {
      id: `${sampleId}-q${String(index + 1).padStart(3, "0")}`,
      index,
      category: entry.category,
      categoryName: LOCOMO_CATEGORIES[entry.category],
      question: entry.question,
      referenceAnswer: reference,
      evidence: [...entry.evidence],
      adversarial,
    };
  });
}

function parseConversation(value: unknown): LocomoConversation {
  const parsed = sampleSchema.parse(value);
  const speakerA = parsed.conversation["speaker_a"];
  const speakerB = parsed.conversation["speaker_b"];
  if (typeof speakerA !== "string" || typeof speakerB !== "string") {
    throw new Error(`LoCoMo ${parsed.sample_id} does not name both speakers`);
  }
  const sessions = parseSessions(parsed.conversation);
  if (sessions.length === 0) throw new Error(`LoCoMo ${parsed.sample_id} has no sessions`);
  return {
    sampleId: parsed.sample_id,
    speakerA,
    speakerB,
    sessions,
    questions: parseQuestions(parsed.sample_id, parsed.qa),
  };
}

function readSummary(value: unknown): LocomoConversationSummary {
  const conversation = parseConversation(value);
  const byCategory = Object.fromEntries(
    LOCOMO_CATEGORY_NUMBERS.map((category) => [
      category,
      conversation.questions.filter((entry) => entry.category === category).length,
    ]),
  ) as Record<LocomoCategory, number>;
  return {
    sampleId: conversation.sampleId,
    sessions: conversation.sessions.length,
    turns: conversation.sessions.reduce((total, session) => total + session.turns.length, 0),
    questions: conversation.questions.length,
    byCategory,
  };
}

export function listLocomoConversations(path = LOCOMO_DATASET_PATH): LocomoConversationSummary[] {
  return rawDataset(path).map(readSummary);
}

/**
 * Narrows one conversation's questions without touching its history.
 *
 * The whole conversation is always distilled: dropping sessions would change what the
 * knowledge base contains, and a question's difficulty in LoCoMo comes from how far apart
 * its evidence sits. Only the asking is narrowed, which is what makes a short run a cheap
 * sample of the same measurement rather than a different one.
 */
export function selectLocomoQuestions(
  questions: LocomoQuestion[],
  selection: Pick<LocomoSelection, "questions" | "stratify">,
): LocomoQuestion[] {
  if (selection.stratify !== undefined) {
    return LOCOMO_CATEGORY_NUMBERS.flatMap((category) =>
      questions.filter((entry) => entry.category === category).slice(0, selection.stratify));
  }
  if (selection.questions !== undefined) return questions.slice(0, selection.questions);
  return questions;
}

export function selectLocomoConversations(
  summaries: LocomoConversationSummary[],
  selection: LocomoSelection,
): LocomoConversationSummary[] {
  validateLocomoSelection(selection);
  if (selection.conversationId) {
    const found = summaries.find((entry) => entry.sampleId === selection.conversationId);
    if (!found) throw new Error(`Unknown LoCoMo conversation: ${selection.conversationId}`);
    return [found];
  }
  if (selection.limit !== undefined) return summaries.slice(0, selection.limit);
  return summaries;
}

export function selectAndReadLocomoConversations(
  path: string,
  selection: LocomoSelection,
): LocomoConversation[] {
  const raw = rawDataset(path);
  const selected = selectLocomoConversations(raw.map(readSummary), selection);
  const wanted = new Set(selected.map((entry) => entry.sampleId));
  const parsed = raw.flatMap((value) => {
    const summary = sampleSchema.pick({ sample_id: true }).parse(value);
    return wanted.has(summary.sample_id) ? [parseConversation(value)] : [];
  });
  const byId = new Map(parsed.map((entry) => [entry.sampleId, entry]));
  return selected.map((entry) => {
    const conversation = byId.get(entry.sampleId)!;
    return { ...conversation, questions: selectLocomoQuestions(conversation.questions, selection) };
  });
}

export function validateLocomoSelection(selection: LocomoSelection): void {
  const chosen = [
    selection.conversationId !== undefined,
    selection.limit !== undefined,
    selection.all === true,
  ].filter(Boolean).length;
  if (chosen !== 1) {
    throw new Error("Choose exactly one of --conversation <id>, --limit <n>, or --all.");
  }
  if (selection.conversationId !== undefined && selection.conversationId.length === 0) {
    throw new Error("--conversation requires a non-empty LoCoMo sample id");
  }
  if (selection.questions !== undefined && selection.stratify !== undefined) {
    throw new Error("--questions and --stratify both narrow the same question set; choose one.");
  }
  for (const [name, value] of [
    ["--limit", selection.limit],
    ["--questions", selection.questions],
    ["--stratify", selection.stratify],
  ] as const) {
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

export async function verifyLocomoDataset(path = LOCOMO_DATASET_PATH): Promise<boolean> {
  if (!existsSync(path)) return false;
  const file = await stat(path);
  return file.size === LOCOMO_DATASET.bytes && await sha256(path) === LOCOMO_DATASET.sha256;
}

/**
 * Downloads the pinned dataset to `path`, through a temporary file that is only promoted
 * once its bytes verify. An interrupted or mismatched download leaves nothing behind.
 *
 * Exported so `dataset.test.ts` can drive it with a stub fetcher. That test is the reason
 * this is a function rather than four lines inside `ensureLocomoDataset`: the download
 * previously guarded on `!response.ok || !response.body`, and reading `response.body`
 * starts the stream, so `Bun.write` then waited forever on a body it could no longer
 * consume. Every `locomo:fetch` and `longmem:fetch` hung. Nothing catches that without
 * actually running a download.
 */
export async function downloadLocomoDataset(
  path: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.download-${randomUUID()}`;
  const response = await fetcher(LOCOMO_DATASET_URL);
  // Deliberately only `ok`, never `body` — see above.
  if (!response.ok) {
    throw new Error(`LoCoMo download failed with HTTP ${response.status}`);
  }
  try {
    await Bun.write(temporary, response);
    if (!await verifyLocomoDataset(temporary)) {
      throw new Error("Downloaded LoCoMo dataset does not match the pinned size and SHA-256");
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function ensureLocomoDataset(options: {
  path?: string;
  fetcher?: typeof fetch;
} = {}): Promise<string> {
  const path = options.path ?? LOCOMO_DATASET_PATH;
  if (path !== LOCOMO_DATASET_PATH) {
    if (!await verifyLocomoDataset(path)) {
      throw new Error(`${path} does not match the pinned LoCoMo size and SHA-256`);
    }
    return path;
  }
  if (await verifyLocomoDataset(path)) return path;
  await downloadLocomoDataset(path, options.fetcher ?? fetch);
  return path;
}
