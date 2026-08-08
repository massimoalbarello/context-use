import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCorpus, type Corpus, type CorpusRecord } from "../corpus-records.ts";

/**
 * Stage 0 of the gold-standard workflow: a purely descriptive, fully deterministic
 * profile of the corpus.
 *
 * Nothing here decides what a knowledge base *should* contain. It only measures what
 * the corpus actually says, so that later stages argue from evidence rather than from
 * a reading of a handful of files. The profile is committed alongside the code and a
 * test asserts it still regenerates, which turns any drift in the corpus or in this
 * derivation into a reviewable diff.
 *
 * Three things it exists to surface, and the difference between them matters:
 *
 *  - **Planted perturbations.** Upstream deliberately seeded contradictions, stale
 *    facts and prompt-injection payloads, and left `fixture_id` markers on the items
 *    carrying them. This is answer key we did not have to author. The markers live in
 *    the JSONL envelope and never reach a record body, so the agent cannot see them.
 *
 *  - **Identity.** Upstream marks every entity reference with its own canonical slug,
 *    so the slug is an answer key for coreference. The surface labels around those
 *    slugs are not clean: one slug carries four spellings of NovaMind, and the bare
 *    label "Priya" stands for three different people. Both directions are enumerated.
 *
 *  - **Generator artifacts.** Several structural signals are index arithmetic rather
 *    than meaning, and the entity sprawl is unconstrained prose generation rather than
 *    a planted test. Neither is a target. Treating an artifact as signal would score a
 *    knowledge base for reproducing a defect.
 */

/** Namespaces upstream uses for the same underlying kind of entity, in its own spellings. */
const PERSON_NAMESPACES = new Set(["people", "person", "user"]);
const ORGANISATION_NAMESPACES = new Set(["companies", "company", "orgs", "org", "organizations", "fund"]);

/** The corpus owner. Any other slug in the `user/` namespace is upstream mislabelling. */
const OWNER_SLUG = "amara-okafor";

const REFERENCE_PATTERN = /\[([^\]]+)\]\(([a-z]+)\/([a-z0-9-]+)\)/g;

export type EntityKind = "person" | "organisation" | "other";

export type ProfiledEntity = {
  slug: string;
  kind: EntityKind;
  /** Every namespace the slug is written under, sorted. More than one is upstream drift. */
  namespaces: string[];
  /** Every distinct surface form, verbatim, sorted. Zero-width characters are preserved. */
  labels: string[];
  /** Records mentioning the entity, sorted, so a window filter is derivable downstream. */
  records: string[];
  sourceTypes: string[];
  mentions: number;
  firstDay: string;
  lastDay: string;
};

export type CorpusProfile = {
  corpusId: string;
  totals: {
    manifestItems: number;
    records: number;
    days: number;
    entities: number;
    /** Entities carried by exactly one record: the corpus is dominated by passing mentions. */
    singleRecordEntities: number;
    multiSourceEntities: number;
  };
  days: { day: string; records: number; items: number; byType: Record<string, number> }[];
  entities: ProfiledEntity[];
  confusions: {
    /** One normalised label standing for several distinct slugs — "Priya", "Marcus", "Meridian". */
    sharedLabel: { label: string; slugs: string[] }[];
    /** One slug written several ways — the four spellings of NovaMind. */
    sharedSlug: { slug: string; labels: string[] }[];
    /** A label sharing no word with the slug it links to: upstream pointed at the wrong entity. */
    labelMismatch: { slug: string; label: string; records: string[] }[];
    namespaceSplit: { slug: string; namespaces: string[] }[];
  };
  /**
   * Upstream's own answer key, read from the JSONL envelope. These markers never reach a
   * record body, so they are ground truth the system under test cannot see.
   */
  perturbations: {
    planted: { item: string; kind: string; fixtureId: string; day: string; sourceType: string }[];
    /**
     * Perturbations upstream's generator designed but whose markers did not survive into
     * the vendored data, because meeting and note front matter has no perturbation field.
     * Recorded so nobody mistakes the marked set for the designed set.
     */
    designedButUnmarked: { kind: string; designed: number; marked: number }[];
  };
  /**
   * Structure that looks like meaning but is index arithmetic or unconstrained prose
   * generation. None of it is a target; a knowledge base reproducing it is not correct.
   */
  generatorArtifacts: {
    /** Slugs other than the owner written as `user/`, so the namespace cannot identify the owner. */
    ownerNamespaceMisuse: string[];
    /** Declared email threads pairing two messages that share no entity. `thread_id` is floor(index / 2). */
    nominalEmailThreads: { threadId: string; items: string[] }[];
    /** Meetings whose `linked_calendar` event has different attendees or a different date. */
    linkedCalendarMismatch: { meeting: string; event: string; meetingAttendees: string[]; eventAttendees: string[] }[];
    /** Note topics reused across days. Upstream regenerates them from a one-word hint. */
    recurringNoteTopics: { topic: string; days: string[] }[];
    /** Person slugs invented during prose generation, outside upstream's designed cast. */
    uncastPersonSlugs: string[];
  };
};

/**
 * Upstream's designed cast, transcribed from `DEFAULT_CONTACTS` in its own
 * `eval/generators/amara-life.ts`: fifteen contacts plus the owner. Every other person
 * slug in the corpus was invented by the prose generator, which was told to write
 * `[Name](people/slug)` but never given a closed vocabulary to draw from.
 */
const DESIGNED_CAST = new Set([
  "amara-okafor", "mina-kapoor", "priya-patel", "marcus-reid", "sarah-chen", "jordan-park",
  "hannah-liu", "diego-alvarez", "elena-rossi", "kofi-mensah", "ravi-gupta", "lena-park",
  "tomoko-sato", "bill-hart", "nadia-freeman", "anna-petrov",
]);

/** What upstream's generator says it planted, against what the vendored data still marks. */
const DESIGNED_PERTURBATIONS: Record<string, number> = {
  contradiction: 10,
  "stale-fact": 5,
  poison: 5,
  "implicit-preference": 3,
};

/** Collapses spelling noise so that distinct entities sharing a surface form are found. */
function normaliseLabel(label: string): string {
  return label
    // Upstream leaves a zero-width space inside one NovaMind mention.
    .replace(/[\u200b-\u200f\ufeff]/gu, "")
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when the label plausibly names the slug, allowing "NovaMinds" to match `novamind`. */
function labelNamesSlug(label: string, slug: string): boolean {
  const slugWords = slug.split("-");
  const labelWords = normaliseLabel(label).split(" ").filter(Boolean);
  if (labelWords.length === 0) return true;
  return labelWords.some((word) => slugWords.some((part) =>
    word === part
    || (word.length >= 4 && part.startsWith(word))
    || (part.length >= 4 && word.startsWith(part))));
}

function frontMatter(body: string): Record<string, string> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  const fields: Record<string, string> = {};
  for (const line of block?.[1]?.split(/\r?\n/) ?? []) {
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (match) fields[match[1]!] = match[2]!.trim();
  }
  return fields;
}

function bracketList(value: string | undefined): string[] {
  if (!value) return [];
  return value.replace(/^\[|\]$/g, "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function entityKind(namespaces: Set<string>): EntityKind {
  for (const namespace of namespaces) {
    if (PERSON_NAMESPACES.has(namespace)) return "person";
    if (ORGANISATION_NAMESPACES.has(namespace)) return "organisation";
  }
  return "other";
}

function profileEntities(records: CorpusRecord[]): ProfiledEntity[] {
  type Accumulator = {
    namespaces: Set<string>;
    labels: Set<string>;
    records: Set<string>;
    sourceTypes: Set<string>;
    days: string[];
    mentions: number;
  };
  const accumulated = new Map<string, Accumulator>();

  for (const record of records) {
    for (const match of record.markdown.matchAll(REFERENCE_PATTERN)) {
      const [, label, namespace, slug] = match as unknown as [string, string, string, string];
      const entry = accumulated.get(slug) ?? {
        namespaces: new Set<string>(), labels: new Set<string>(), records: new Set<string>(),
        sourceTypes: new Set<string>(), days: [], mentions: 0,
      };
      entry.namespaces.add(namespace);
      entry.labels.add(label);
      entry.records.add(record.slug);
      entry.sourceTypes.add(record.type);
      entry.days.push(record.day);
      entry.mentions += 1;
      accumulated.set(slug, entry);
    }
  }

  return [...accumulated].map(([slug, entry]) => {
    const days = [...entry.days].sort();
    return {
      slug,
      kind: entityKind(entry.namespaces),
      namespaces: [...entry.namespaces].sort(),
      labels: [...entry.labels].sort(),
      records: [...entry.records].sort(),
      sourceTypes: [...entry.sourceTypes].sort(),
      mentions: entry.mentions,
      firstDay: days[0]!,
      lastDay: days.at(-1)!,
    };
  }).sort((left, right) => left.slug.localeCompare(right.slug));
}

function profileConfusions(records: CorpusRecord[], entities: ProfiledEntity[]): CorpusProfile["confusions"] {
  const byLabel = new Map<string, Set<string>>();
  for (const entity of entities) {
    for (const label of entity.labels) {
      const normalised = normaliseLabel(label);
      byLabel.set(normalised, (byLabel.get(normalised) ?? new Set()).add(entity.slug));
    }
  }

  const mismatchRecords = new Map<string, Set<string>>();
  for (const record of records) {
    for (const match of record.markdown.matchAll(REFERENCE_PATTERN)) {
      const [, label, , slug] = match as unknown as [string, string, string, string];
      if (labelNamesSlug(label, slug)) continue;
      const key = JSON.stringify([slug, label]);
      mismatchRecords.set(key, (mismatchRecords.get(key) ?? new Set()).add(record.slug));
    }
  }

  return {
    sharedLabel: [...byLabel]
      .filter(([, slugs]) => slugs.size > 1)
      .map(([label, slugs]) => ({ label, slugs: [...slugs].sort() }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    sharedSlug: entities
      .filter((entity) => new Set(entity.labels.map(normaliseLabel)).size > 1)
      .map((entity) => ({ slug: entity.slug, labels: entity.labels })),
    labelMismatch: [...mismatchRecords]
      .map(([key, records_]) => {
        const [slug, label] = JSON.parse(key) as [string, string];
        return { slug, label, records: [...records_].sort() };
      })
      .sort((left, right) => left.slug.localeCompare(right.slug) || left.label.localeCompare(right.label)),
    namespaceSplit: entities
      .filter((entity) => entity.namespaces.length > 1)
      .map((entity) => ({ slug: entity.slug, namespaces: entity.namespaces })),
  };
}

type EmailEnvelope = { slug: string; thread_id: string | null; body_text: string };

function profileArtifacts(
  corpus: Corpus,
  entities: ProfiledEntity[],
  emails: EmailEnvelope[],
): CorpusProfile["generatorArtifacts"] {
  const ownerNamespaceMisuse = entities
    .filter((entity) => entity.namespaces.includes("user") && entity.slug !== OWNER_SLUG)
    .map((entity) => entity.slug);

  const uncastPersonSlugs = entities
    .filter((entity) => entity.kind === "person" && !DESIGNED_CAST.has(entity.slug))
    .map((entity) => entity.slug);

  // `thread_id` is floor(index / 2) over emails whose counterparties are drawn
  // independently, so a "thread" is two unrelated messages far more often than not.
  const threads = new Map<string, EmailEnvelope[]>();
  for (const email of emails) {
    const key = email.thread_id ?? email.slug;
    threads.set(key, [...(threads.get(key) ?? []), email]);
  }
  const nominalEmailThreads: { threadId: string; items: string[] }[] = [];
  for (const [threadId, messages] of threads) {
    if (messages.length < 2) continue;
    const perMessage = messages.map((message) =>
      new Set([...message.body_text.matchAll(REFERENCE_PATTERN)].map((match) => match[3]!)));
    const shared = [...perMessage[0]!].some((slug) => perMessage.slice(1).every((set) => set.has(slug)));
    if (!shared) nominalEmailThreads.push({ threadId, items: messages.map((message) => message.slug).sort() });
  }
  nominalEmailThreads.sort((left, right) => left.threadId.localeCompare(right.threadId));

  const calendar = new Map(corpus.records
    .filter((record) => record.type === "calendar-event")
    .map((record) => [record.slug, record]));
  const linkedCalendarMismatch: CorpusProfile["generatorArtifacts"]["linkedCalendarMismatch"] = [];
  const recurring = new Map<string, string[]>();

  for (const record of corpus.records) {
    if (record.type === "note") {
      const topic = frontMatter(record.markdown).topic;
      if (topic) recurring.set(topic, [...(recurring.get(topic) ?? []), record.day]);
      continue;
    }
    if (record.type !== "meeting") continue;
    const fields = frontMatter(record.markdown);
    const linked = fields.linked_calendar;
    if (!linked) continue;
    const event = calendar.get(linked);
    if (!event) continue;
    // Meeting attendees are namespaced slugs; the event names people in plain text.
    const meetingAttendees = bracketList(fields.attendees);
    const eventAttendees = (/\*\*Attendees:\*\* (.*)/.exec(event.markdown)?.[1] ?? "")
      .split(", ").map((entry) => entry.replace(/\s*<.*/, "").trim()).filter(Boolean);
    const namesMatch = meetingAttendees.every((attendee) => {
      const words = attendee.split("/").at(-1)!.split("-");
      return eventAttendees.some((name) => words.every((word) => normaliseLabel(name).includes(word)));
    });
    if (!namesMatch || event.day !== record.day) {
      linkedCalendarMismatch.push({
        meeting: record.slug, event: linked, meetingAttendees, eventAttendees,
      });
    }
  }

  return {
    ownerNamespaceMisuse,
    nominalEmailThreads,
    linkedCalendarMismatch,
    recurringNoteTopics: [...recurring]
      .filter(([, days]) => days.length > 1)
      .map(([topic, days]) => ({ topic, days: [...days].sort() }))
      .sort((left, right) => left.topic.localeCompare(right.topic)),
    uncastPersonSlugs,
  };
}

/**
 * Reads the `perturbation` markers upstream leaves on the JSONL envelope. They are the
 * one part of the corpus deliberately planted to be got right, and the renderer never
 * copies them into a record body, so the system under test cannot read the answer.
 */
function profilePerturbations(
  entries: { slug: string; ts: string; sourceType: string; perturbation?: { kind: string; fixture_id: string } }[],
): CorpusProfile["perturbations"] {
  const planted = entries
    .filter((entry) => entry.perturbation)
    .map((entry) => ({
      item: entry.slug,
      kind: entry.perturbation!.kind,
      fixtureId: entry.perturbation!.fixture_id,
      day: entry.ts.slice(0, 10),
      sourceType: entry.sourceType,
    }))
    .sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));

  return {
    planted,
    designedButUnmarked: Object.entries(DESIGNED_PERTURBATIONS)
      .map(([kind, designed]) => ({
        kind,
        designed,
        marked: planted.filter((entry) => entry.kind === kind).length,
      }))
      .filter((entry) => entry.marked < entry.designed)
      .sort((left, right) => left.kind.localeCompare(right.kind)),
  };
}

export function profileCorpus(corpus: Corpus, directory: string): CorpusProfile {
  const entities = profileEntities(corpus.records);
  const byDay = new Map<string, CorpusRecord[]>();
  for (const record of corpus.records) {
    byDay.set(record.day, [...(byDay.get(record.day) ?? []), record]);
  }

  const readEnvelope = (path: string, sourceType: string) =>
    readFileSync(join(directory, path), "utf8").split("\n").filter((line) => line.trim())
      .map((line) => ({ ...JSON.parse(line), sourceType }));
  const emailEnvelopes = readEnvelope(join("inbox", "emails.jsonl"), "email");
  const slackEnvelopes = readEnvelope(join("slack", "messages.jsonl"), "slack");

  return {
    corpusId: corpus.corpusId,
    totals: {
      manifestItems: corpus.records.reduce((total, record) => total + record.itemSlugs.length, 0),
      records: corpus.records.length,
      days: corpus.days.length,
      entities: entities.length,
      singleRecordEntities: entities.filter((entity) => entity.records.length === 1).length,
      multiSourceEntities: entities.filter((entity) => entity.sourceTypes.length > 1).length,
    },
    days: [...byDay].sort(([left], [right]) => left.localeCompare(right)).map(([day, records]) => ({
      day,
      records: records.length,
      items: records.reduce((total, record) => total + record.itemSlugs.length, 0),
      byType: records.reduce<Record<string, number>>((totals, record) => {
        totals[record.type] = (totals[record.type] ?? 0) + 1;
        return totals;
      }, {}),
    })),
    entities,
    confusions: profileConfusions(corpus.records, entities),
    perturbations: profilePerturbations([...emailEnvelopes, ...slackEnvelopes]),
    generatorArtifacts: profileArtifacts(corpus, entities, emailEnvelopes),
  };
}

export function profileCorpusAt(directory: string): CorpusProfile {
  return profileCorpus(loadCorpus(directory), directory);
}
