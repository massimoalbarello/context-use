import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type {
  ReadSourceRecordsInput,
  ReadSourceRecordsResult,
  SourceRecord,
  SourceRecordReader,
} from "../apps/server/src/nango-records.ts";
import { SourceRecordCheckpointError } from "../apps/server/src/nango-records.ts";

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
 * One read advances through exactly one corpus day. `has_more` stays true while that
 * day still holds records, then the checkpoint moves to the next day that has any. An
 * automation run therefore consumes one day and stops, the way a scheduled production
 * run consumes whatever a source has produced since its last checkpoint.
 *
 * Nango's 30-day freshness window is deliberately absent: it exists because Nango
 * backfills historical records, which a fixed corpus never does. Corpus dates are
 * served exactly as authored.
 */

export const CORPUS_WINDOWS = ["dense", "full"] as const;
export type CorpusWindow = (typeof CORPUS_WINDOWS)[number];

/** First day of the eight-day window holding 379 of the corpus's 418 items. */
const DENSE_WINDOW_START = "2026-04-13";

const CHECKPOINT_PREFIX = "cu-corpus-v1.";
const DEFAULT_RECORD_LIMIT = 50;
const MAX_RECORD_LIMIT = 100;
const DEFAULT_RESPONSE_BYTE_BUDGET = 5_000_000;

const ITEM_TYPES = ["note", "meeting", "email", "slack", "calendar-event"] as const;
type CorpusItemType = (typeof ITEM_TYPES)[number];

const SOURCE_LABELS: Record<CorpusItemType, string> = {
  note: "Notes",
  meeting: "Meeting notes",
  email: "Email",
  slack: "Slack",
  "calendar-event": "Calendar",
};

const manifestSchema = z.object({
  schema_version: z.number().int(),
  corpus_id: z.string().min(1),
  license: z.string().min(1),
  items: z.array(z.object({
    slug: z.string().min(1),
    path: z.string().min(1),
    type: z.enum(ITEM_TYPES),
    content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1),
}).loose();

const emailSchema = z.object({
  slug: z.string(),
  ts: z.iso.datetime(),
  from: z.object({ name: z.string(), email: z.string() }),
  to: z.array(z.object({ name: z.string(), email: z.string() })).default([]),
  subject: z.string(),
  thread_id: z.string().nullable().default(null),
  in_reply_to: z.string().nullable().default(null),
  body_text: z.string(),
  perturbation: z.object({ kind: z.string(), fixture_id: z.string() }).nullish(),
}).loose();

const slackSchema = z.object({
  slug: z.string(),
  ts: z.iso.datetime(),
  channel: z.string(),
  user: z.object({ name: z.string(), handle: z.string() }),
  thread_ts: z.string().nullable().default(null),
  text: z.string(),
  perturbation: z.object({ kind: z.string(), fixture_id: z.string() }).nullish(),
}).loose();

const checkpointSchema = z.object({
  version: z.literal(1),
  corpus_id: z.string().min(1),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  index: z.number().int().min(0),
}).strict();

type Checkpoint = z.infer<typeof checkpointSchema>;

export type CorpusRecord = {
  /** The upstream manifest slug. One record carries exactly one manifest item. */
  slug: string;
  type: CorpusItemType;
  /** Calendar day in UTC, the unit one automation run consumes. */
  day: string;
  timestamp: string;
  markdown: string;
  /** Always `added`: a fixed corpus never revises an item it has already served. */
  action: "added" | "updated";
  /** Manifest items carried by this record, used to prove nothing is dropped. */
  itemSlugs: string[];
  /**
   * Upstream's own answer key for the items it deliberately seeded, read from the JSONL
   * envelope. `read()` maps only four fields into a `SourceRecord`, so this never reaches
   * the agent; a test asserts as much.
   */
  perturbation?: { kind: string; fixtureId: string };
};

export type Corpus = {
  corpusId: string;
  license: string;
  records: CorpusRecord[];
  /** Every distinct day holding at least one record, ascending. */
  days: string[];
};

function frontMatterField(body: string, field: string): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  if (!block?.[1]) return undefined;
  return new RegExp(`^${field}:\\s*(\\S+)\\s*$`, "m").exec(block[1])?.[1];
}

function icsTimestamp(value: string): string {
  const parsed = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value.trim());
  if (!parsed) throw new Error(`Corpus calendar has an unsupported DTSTART: ${value}`);
  const [, year, month, day, hour, minute, second] = parsed;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}

type CalendarEvent = {
  uid: string;
  start: string;
  end?: string;
  summary?: string;
  location?: string;
  description?: string;
  attendees: string[];
};

function parseCalendar(text: string): Map<string, CalendarEvent> {
  const events = new Map<string, CalendarEvent>();
  // Unfold RFC 5545 continuation lines before reading properties.
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  let current: Partial<CalendarEvent> & { attendees: string[] } | undefined;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = { attendees: [] };
      continue;
    }
    if (!current) continue;
    if (line === "END:VEVENT") {
      if (!current.uid || !current.start) throw new Error("Corpus calendar has an event without UID or DTSTART");
      events.set(current.uid, current as CalendarEvent);
      current = undefined;
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const property = name.split(";")[0]!;
    if (property === "UID") current.uid = value.split("@")[0] ?? value;
    else if (property === "DTSTART") current.start = icsTimestamp(value);
    else if (property === "DTEND") current.end = icsTimestamp(value);
    else if (property === "SUMMARY") current.summary = value;
    else if (property === "LOCATION") current.location = value;
    else if (property === "DESCRIPTION") current.description = value;
    else if (property === "ATTENDEE") {
      const name_ = /CN=([^:;]+)/.exec(name)?.[1];
      const mail = value.replace(/^mailto:/i, "");
      current.attendees.push(name_ ? `${name_} <${mail}>` : mail);
    }
  }
  return events;
}

/**
 * One message is one record, and the declared thread is deliberately not surfaced.
 *
 * Upstream's threading carries no meaning. `thread_id` is `floor(index / 2)` over emails
 * whose counterparties are drawn independently at random, and `thread_ts` groups every
 * tenth Slack message across four channels that rotate by index. Upstream's own prose
 * generator then wrote every item in isolation: it was handed `In-Reply-To: em-0000` and
 * `Thread parent: <timestamp>` as bare identifiers, never the text being replied to, and
 * told to "acknowledge thread context". That is why `thr-0000` is Ravi introducing
 * Terraform Dynamics followed by Amara thanking Bill about Terraform Industries, and why
 * a fund-close announcement draws two replies agreeing about timeline concerns nobody
 * raised.
 *
 * Grouping those into one body, or pointing at them from one, would assert a relationship
 * the corpus does not contain and would penalise a knowledge base for not inventing it.
 * Each message body was authored standalone, so a message is already the complete
 * semantic body the envelope contract asks for.
 */
function renderEmail(email: z.infer<typeof emailSchema>): string {
  const recipients = email.to.map((person) => `${person.name} <${person.email}>`).join(", ");
  const lines = [
    `# ${email.subject}`,
    "",
    `**From:** ${email.from.name} <${email.from.email}>`,
    ...(recipients ? [`**To:** ${recipients}`] : []),
    `**Sent:** ${email.ts}`,
    "",
    email.body_text,
  ];
  return `${lines.join("\n")}\n`;
}

function renderSlack(message: z.infer<typeof slackSchema>): string {
  const lines = [
    `# ${message.channel} — ${message.user.name}`,
    "",
    `**Channel:** ${message.channel}`,
    `**From:** ${message.user.name} (@${message.user.handle})`,
    `**Sent:** ${message.ts}`,
    "",
    message.text,
  ];
  return `${lines.join("\n")}\n`;
}

function renderCalendarEvent(event: CalendarEvent): string {
  const lines = [
    `# ${event.summary ?? event.uid}`,
    "",
    `**Starts:** ${event.start}`,
    ...(event.end ? [`**Ends:** ${event.end}`] : []),
    ...(event.location ? [`**Location:** ${event.location}`] : []),
    ...(event.attendees.length ? [`**Attendees:** ${event.attendees.join(", ")}`] : []),
    ...(event.description ? ["", event.description] : []),
  ];
  return `${lines.join("\n")}\n`;
}

function readJsonLines<T>(path: string, schema: z.ZodType<T>): Map<string, T> {
  const entries = new Map<string, T>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const parsed = schema.parse(JSON.parse(line));
    entries.set((parsed as { slug: string }).slug, parsed);
  }
  return entries;
}

/**
 * Reads the corpus from disk and verifies every file-backed item against the upstream
 * manifest's own `content_sha256`, so a modified corpus fails loudly rather than
 * silently changing what an evaluation measured.
 */
export function loadCorpus(directory: string): Corpus {
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(directory, "corpus-manifest.json"), "utf8")),
  );
  const calendar = parseCalendar(readFileSync(join(directory, "calendar.ics"), "utf8"));
  const emails = readJsonLines(join(directory, "inbox", "emails.jsonl"), emailSchema);
  const slack = readJsonLines(join(directory, "slack", "messages.jsonl"), slackSchema);

  const records: CorpusRecord[] = [];

  for (const item of manifest.items) {
    if (item.type === "note" || item.type === "meeting") {
      const body = readFileSync(join(directory, item.path), "utf8");
      const digest = createHash("sha256").update(body, "utf8").digest("hex");
      if (digest !== item.content_sha256) {
        throw new Error(`Corpus item ${item.slug} does not match the upstream manifest hash`);
      }
      const date = frontMatterField(body, "date");
      if (!date) throw new Error(`Corpus item ${item.slug} has no front-matter date`);
      const timestamp = `${date}T00:00:00.000Z`;
      // Served verbatim: the authored Markdown is already the semantic body.
      records.push({
        slug: item.slug, type: item.type, day: date, timestamp,
        markdown: body, action: "added", itemSlugs: [item.slug],
      });
    } else if (item.type === "email") {
      const email = emails.get(item.slug);
      if (!email) throw new Error(`Corpus item ${item.slug} is missing from emails.jsonl`);
      records.push({
        slug: item.slug, type: item.type, day: email.ts.slice(0, 10), timestamp: email.ts,
        markdown: renderEmail(email), action: "added", itemSlugs: [item.slug],
        ...(email.perturbation
          ? { perturbation: { kind: email.perturbation.kind, fixtureId: email.perturbation.fixture_id } }
          : {}),
      });
    } else if (item.type === "slack") {
      const message = slack.get(item.slug);
      if (!message) throw new Error(`Corpus item ${item.slug} is missing from messages.jsonl`);
      records.push({
        slug: item.slug, type: item.type, day: message.ts.slice(0, 10), timestamp: message.ts,
        markdown: renderSlack(message), action: "added", itemSlugs: [item.slug],
        ...(message.perturbation
          ? { perturbation: { kind: message.perturbation.kind, fixtureId: message.perturbation.fixture_id } }
          : {}),
      });
    } else {
      const uid = item.slug.split("/").at(-1)!;
      const event = calendar.get(uid);
      if (!event) throw new Error(`Corpus item ${item.slug} is missing from calendar.ics`);
      records.push({
        slug: item.slug,
        type: item.type,
        day: event.start.slice(0, 10),
        timestamp: event.start,
        markdown: renderCalendarEvent(event),
        action: "added",
        itemSlugs: [item.slug],
      });
    }
  }

  records.sort((left, right) => left.timestamp.localeCompare(right.timestamp)
    || left.slug.localeCompare(right.slug));

  const covered = new Set(records.flatMap((record) => record.itemSlugs));
  const missing = manifest.items.filter((item) => !covered.has(item.slug));
  if (missing.length) {
    throw new Error(`Corpus items were dropped rather than served: ${
      missing.slice(0, 5).map((item) => item.slug).join(", ")}`);
  }

  return {
    corpusId: manifest.corpus_id,
    license: manifest.license,
    records,
    days: [...new Set(records.map((record) => record.day))].sort(),
  };
}

function encodeCheckpoint(checkpoint: Checkpoint): string {
  const encoded = Buffer.from(JSON.stringify(checkpoint), "utf8").toString("base64url");
  const checksum = createHash("sha256").update(encoded).digest("hex");
  return `${CHECKPOINT_PREFIX}${encoded}.${checksum}`;
}

function decodeCheckpoint(corpusId: string, firstDay: string | null, value?: string): Checkpoint {
  if (!value) return { version: 1, corpus_id: corpusId, day: firstDay, index: 0 };
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
  readonly #days: string[];
  readonly #byDay: Map<string, CorpusRecord[]>;
  readonly #responseByteBudget: number;

  constructor(options: CorpusRecordReaderOptions) {
    const corpus = loadCorpus(options.directory);
    const window = options.window ?? "full";
    const records = window === "dense"
      ? corpus.records.filter((record) => record.day >= DENSE_WINDOW_START)
      : corpus.records;
    if (records.length === 0) throw new Error(`Corpus window ${window} selected no records`);
    this.#corpus = corpus;
    this.#byDay = new Map();
    for (const record of records) {
      const day = this.#byDay.get(record.day) ?? [];
      day.push(record);
      this.#byDay.set(record.day, day);
    }
    this.#days = [...this.#byDay.keys()].sort();
    this.#responseByteBudget = options.responseByteBudget ?? DEFAULT_RESPONSE_BYTE_BUDGET;
  }

  /** Every day this reader will serve, in order, so a harness can drive one run per day. */
  get days(): string[] {
    return [...this.#days];
  }

  get corpusId(): string {
    return this.#corpus.corpusId;
  }

  #nextDay(day: string): string | null {
    const index = this.#days.indexOf(day);
    if (index === -1) return this.#days.find((candidate) => candidate > day) ?? null;
    return this.#days[index + 1] ?? null;
  }

  async read(input: ReadSourceRecordsInput): Promise<ReadSourceRecordsResult> {
    const limit = input.limit ?? DEFAULT_RECORD_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECORD_LIMIT) {
      throw new Error(`Record limit must be between 1 and ${MAX_RECORD_LIMIT}`);
    }
    const checkpoint = decodeCheckpoint(this.#corpus.corpusId, this.#days[0] ?? null, input.checkpoint);
    if (checkpoint.day === null) {
      return { records: [], next_checkpoint: encodeCheckpoint(checkpoint), has_more: false };
    }

    const dayRecords = this.#byDay.get(checkpoint.day) ?? [];
    const records: SourceRecord[] = [];
    let responseBytes = 0;
    let index = checkpoint.index;

    while (index < dayRecords.length && records.length < limit) {
      const record = dayRecords[index]!;
      const source: SourceRecord = {
        record_ref: `corpus:${this.#corpus.corpusId}:${record.slug}`,
        source: SOURCE_LABELS[record.type],
        action: record.action,
        markdown: record.markdown,
      };
      const bytes = Buffer.byteLength(JSON.stringify(source), "utf8") + 1;
      if (records.length > 0 && responseBytes + bytes > this.#responseByteBudget) break;
      records.push(source);
      responseBytes += bytes;
      index += 1;
    }

    // The day is the batch boundary: `has_more` stays true only while this day has
    // records left, so one automation run consumes exactly one day.
    const hasMore = index < dayRecords.length;
    const next: Checkpoint = hasMore
      ? { ...checkpoint, index }
      : { ...checkpoint, day: this.#nextDay(checkpoint.day), index: 0 };
    return { records, next_checkpoint: encodeCheckpoint(next), has_more: hasMore };
  }
}
