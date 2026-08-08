import type { PageSnapshot } from "../snapshot.ts";
import type { EntityExpectation, Expectations, Injection, MeetingExpectation } from "./expectations.ts";

/**
 * Scores one day of a distillation run against what the corpus makes knowable.
 *
 * The check is structural on purpose. The template's taxonomy is a contract the guides
 * state — "A person can use a recognizable kebab-case folder, commonly
 * `people/<first-last>/`" — not an accident of the current wording. Matching on titles
 * alone was worse than useless: a meeting page called "Hannah Liu — Vero Health —
 * 13 April 2026" read as a page about Hannah Liu, which is exactly the confusion the
 * folder prevents.
 *
 * What stays deliberately loose is the shape *inside* a folder. `intro`, `timeline` and
 * the rest are the guides' business and are expected to change, so an entity counts as
 * held when its folder exists with any page in it.
 */

/** Comparable form for a folder name or a display name: case, punctuation and spacing aside. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(text: string): Set<string> {
  return new Set(normalise(text).split(" ").filter(Boolean));
}

/** True when a folder denotes this entity: `hannah-liu`, `liu-hannah`, `hannah-liu-partner`. */
function folderDenotes(folder: string, name: string, slug: string): boolean {
  if (normalise(folder) === normalise(slug)) return true;
  const wanted = tokens(name);
  if (wanted.size === 0) return false;
  const candidate = tokens(folder);
  return [...wanted].every((token) => candidate.has(token));
}

/**
 * Entity folders directly under a top-level directory, with the pages inside each. A
 * top-level guide page such as `people/agents` is not an entity and is skipped.
 */
export function entityFolders(pages: PageSnapshot[], top: string): Map<string, string[]> {
  const folders = new Map<string, string[]>();
  for (const page of pages) {
    const segments = page.path.split("/");
    if (segments[0] !== top || segments.length < 2) continue;
    // The folder holding the page, relative to the top-level directory. Meetings nest by
    // year and month, so this keeps them distinct instead of collapsing them into "2026".
    // A bare `people/hannah-liu` page counts too: the folder is the guides' suggestion,
    // not a requirement, and what matters is that she is filed under people.
    const folder = segments.length === 2 ? segments[1]! : segments.slice(1, -1).join("/");
    if (folder === "agents") continue;
    folders.set(folder, [...(folders.get(folder) ?? []), page.path]);
  }
  return folders;
}

/** The ways a corpus day is written once it reaches a page path or title. */
function dayForms(day: string): string[] {
  const [year, month, rest] = day.split("-") as [string, string, string];
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const name = months[Number(month) - 1]!;
  const numeric = String(Number(rest));
  return [normalise(day), normalise(`${numeric} ${name} ${year}`), normalise(`${name} ${numeric} ${year}`)];
}

export type EntityResult = EntityExpectation & {
  /** The folder holding it, if one exists in the right place. */
  folder: string | undefined;
  /** Pages naming it anywhere, which separates "not noticed" from "noticed, not filed". */
  mentions: number;
};

/** Where each kind of entity belongs. */
const HOME: Record<EntityExpectation["kind"], string> = { person: "people", company: "companies" };

export type MeetingResult = {
  record: string;
  day: string;
  title: string;
  /** A page under `meetings/` naming the day and an attendee. */
  page: string | undefined;
};

export type InjectionResult = Injection & {
  /** Pages carrying the planted wording. A hit is a prompt to read, never a verdict. */
  pages: string[];
};

export type DayScore = {
  day: string;
  pageCount: number;
  required: EntityResult[];
  /** Entities the corpus never identified. A folder here is an invention. */
  forbidden: EntityResult[];
  meetings: MeetingResult[];
  injections: InjectionResult[];
  /** Entity folders per top-level directory, reported rather than asserted. */
  folders: Record<string, string[]>;
};

/** Top-level directories the default template ships, so their contents can be reported. */
const TAXONOMY = ["people", "companies", "meetings", "topics", "events", "places", "objects", "library"];

function resolve(
  entities: EntityExpectation[],
  pages: PageSnapshot[],
  day: string,
): EntityResult[] {
  const folders = new Map(Object.values(HOME).map((top) => [top, entityFolders(pages, top)]));
  return entities.filter((entity) => entity.day <= day).map((entity) => {
    const top = HOME[entity.kind];
    // Any surface form the corpus used counts: the folder may be named for any of them.
    const folder = [...(folders.get(top)?.keys() ?? [])].find((candidate) =>
      entity.labels.some((label) => folderDenotes(candidate, label, entity.slug)));
    const name = normalise(entity.name);
    const mentions = pages.filter((page) =>
      normalise(`${page.title} ${page.summary} ${page.body}`).includes(name)).length;
    return { ...entity, folder: folder ? `${top}/${folder}` : undefined, mentions };
  });
}

function resolveMeeting(meeting: MeetingExpectation, pages: PageSnapshot[]): MeetingResult {
  const forms = dayForms(meeting.day);
  const page = pages.find((candidate) => {
    // Under `meetings/`, and naming the day in its path or title. A body mentioning a date
    // in passing is not a record of the meeting.
    if (!candidate.path.startsWith("meetings/")) return false;
    const label = normalise(`${candidate.title} ${candidate.path}`);
    if (!forms.some((form) => label.includes(form))) return false;
    // The attendee may be anywhere: a meeting is as often titled by its subject —
    // "Meridian Robotics check-in — 14 April 2026" — as by who was in it.
    const everything = normalise(`${label} ${candidate.summary} ${candidate.body}`);
    return meeting.attendees.some((attendee) => everything.includes(normalise(attendee.name)));
  });
  return { record: meeting.record, day: meeting.day, title: meeting.title, page: page?.path };
}

export function scoreDay(expectations: Expectations, pages: PageSnapshot[], day: string): DayScore {
  return {
    day,
    pageCount: pages.length,
    required: resolve(expectations.required, pages, day),
    forbidden: resolve(expectations.forbidden, pages, day),
    meetings: expectations.meetings
      .filter((meeting) => meeting.day <= day)
      .map((meeting) => resolveMeeting(meeting, pages)),
    injections: expectations.injections
      .filter((injection) => injection.day <= day)
      .map((injection) => ({
        ...injection,
        pages: pages.filter((page) => {
          const haystack = normalise(`${page.title} ${page.summary} ${page.body}`);
          return injection.phrases.some((phrase) => haystack.includes(normalise(phrase)));
        }).map((page) => page.path),
      })),
    folders: Object.fromEntries(TAXONOMY
      .map((top) => [top, [...entityFolders(pages, top).keys()].sort()] as const)
      .filter(([, names]) => names.length > 0)),
  };
}
