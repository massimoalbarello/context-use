import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { assembleCorpus, type Corpus, type CorpusRecord } from "../../runner/corpus/types.ts";

/**
 * Loads `amara-life-v1`: raw activity — email, Slack, calendar, meetings and notes —
 * as one record per upstream manifest item, batched by calendar day.
 *
 * Every file-backed item is verified against the upstream manifest's own
 * `content_sha256`, so a modified corpus fails loudly rather than silently changing what
 * an evaluation measured.
 */

/** First day of the eight-day window holding 379 of the corpus's 418 items. */
export const DENSE_WINDOW_START = "2026-04-13";

const ITEM_TYPES = ["note", "meeting", "email", "slack", "calendar-event"] as const;

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

export function loadAmaraCorpus(directory: string): Corpus {
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
      // Served verbatim: the authored Markdown is already the semantic body.
      records.push({
        slug: item.slug, type: item.type, batch: date, day: date,
        timestamp: `${date}T00:00:00.000Z`,
        markdown: body, action: "added", itemSlugs: [item.slug],
      });
    } else if (item.type === "email") {
      const email = emails.get(item.slug);
      if (!email) throw new Error(`Corpus item ${item.slug} is missing from emails.jsonl`);
      records.push({
        slug: item.slug, type: item.type, batch: email.ts.slice(0, 10),
        day: email.ts.slice(0, 10), timestamp: email.ts,
        markdown: renderEmail(email), action: "added", itemSlugs: [item.slug],
        ...(email.perturbation
          ? { perturbation: { kind: email.perturbation.kind, fixtureId: email.perturbation.fixture_id } }
          : {}),
      });
    } else if (item.type === "slack") {
      const message = slack.get(item.slug);
      if (!message) throw new Error(`Corpus item ${item.slug} is missing from messages.jsonl`);
      records.push({
        slug: item.slug, type: item.type, batch: message.ts.slice(0, 10),
        day: message.ts.slice(0, 10), timestamp: message.ts,
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
        batch: event.start.slice(0, 10),
        day: event.start.slice(0, 10),
        timestamp: event.start,
        markdown: renderCalendarEvent(event),
        action: "added",
        itemSlugs: [item.slug],
      });
    }
  }

  records.sort((left, right) => left.timestamp!.localeCompare(right.timestamp!)
    || left.slug.localeCompare(right.slug));

  const covered = new Set(records.flatMap((record) => record.itemSlugs));
  const missing = manifest.items.filter((item) => !covered.has(item.slug));
  if (missing.length) {
    throw new Error(`Corpus items were dropped rather than served: ${
      missing.slice(0, 5).map((item) => item.slug).join(", ")}`);
  }

  return assembleCorpus(manifest.corpus_id, manifest.license, records);
}
