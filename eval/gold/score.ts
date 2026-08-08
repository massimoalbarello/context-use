import type { PageSnapshot } from "../snapshot.ts";
import type { Expectations, Injection, MeetingExpectation } from "./expectations.ts";

/**
 * Scores one day of a distillation run against what the corpus makes knowable.
 *
 * The check is structural on purpose. The template's taxonomy is a contract, not an
 * accident of the current guidelines: a person belongs under `people/<person-slug>/`, a
 * meeting under `meetings/`, and the guides say so. Matching on titles alone was worse
 * than useless — a meeting page called "Hannah Liu — Vero Health — 13 April 2026" read as
 * a page about Hannah Liu, which is exactly the confusion the folder prevents.
 *
 * What stays deliberately loose is the shape *inside* a folder. `intro`, `timeline` and
 * the rest are the guides' business and are expected to change, so a person counts as
 * held when their folder exists with any page in it.
 */

/** Comparable form for a folder name or a person's name: case, punctuation and order aside. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(text: string): Set<string> {
  return new Set(normalise(text).split(" ").filter(Boolean));
}

/** True when a folder name denotes this entity: `hannah-liu`, `liu-hannah`, `hannah-liu-2`. */
function folderDenotes(folder: string, name: string, slug: string): boolean {
  const wanted = tokens(name);
  const candidate = tokens(folder);
  if (normalise(folder) === normalise(slug)) return true;
  if (wanted.size === 0) return false;
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

export type PersonResult = {
  slug: string;
  name: string;
  knowableFrom: string;
  meetings: string[];
  /** The `people/<folder>` holding them, if one exists. */
  folder: string | undefined;
  /** Pages naming them anywhere, which separates "not noticed" from "noticed, not filed". */
  mentions: number;
};

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
  people: PersonResult[];
  meetings: MeetingResult[];
  injections: InjectionResult[];
  /** Entity folders per top-level directory, reported rather than asserted. */
  folders: Record<string, string[]>;
};

/** Top-level directories the default template ships, so their contents can be reported. */
const TAXONOMY = ["people", "companies", "meetings", "topics", "events", "places", "objects", "library"];

function peopleKnowableBy(meetings: MeetingExpectation[], day: string) {
  const people = new Map<string, { name: string; knowableFrom: string; meetings: string[] }>();
  for (const meeting of meetings) {
    if (meeting.day > day) continue;
    for (const attendee of meeting.attendees) {
      const seen = people.get(attendee.slug);
      if (seen) {
        seen.meetings.push(meeting.record);
        if (meeting.day < seen.knowableFrom) seen.knowableFrom = meeting.day;
      } else {
        people.set(attendee.slug, {
          name: attendee.name, knowableFrom: meeting.day, meetings: [meeting.record],
        });
      }
    }
  }
  return people;
}

export function scoreDay(expectations: Expectations, pages: PageSnapshot[], day: string): DayScore {
  const personFolders = entityFolders(pages, "people");

  const people: PersonResult[] = [...peopleKnowableBy(expectations.meetings, day)]
    .map(([slug, entry]) => {
      const folder = [...personFolders.keys()]
        .find((candidate) => folderDenotes(candidate, entry.name, slug));
      const name = normalise(entry.name);
      const mentions = pages.filter((page) =>
        normalise(`${page.title} ${page.summary} ${page.body}`).includes(name)).length;
      return {
        slug, name: entry.name, knowableFrom: entry.knowableFrom, meetings: entry.meetings,
        folder: folder ? `people/${folder}` : undefined, mentions,
      };
    })
    .sort((left, right) => left.knowableFrom.localeCompare(right.knowableFrom)
      || left.slug.localeCompare(right.slug));

  const meetings: MeetingResult[] = expectations.meetings
    .filter((meeting) => meeting.day <= day)
    .map((meeting) => {
      const forms = dayForms(meeting.day);
      const page = pages.find((candidate) => {
        // Under `meetings/`, and naming the day in its path or title. A body mentioning a
        // date in passing is not a record of the meeting.
        if (!candidate.path.startsWith("meetings/")) return false;
        const label = normalise(`${candidate.title} ${candidate.path}`);
        if (!forms.some((form) => label.includes(form))) return false;
        // The attendee may be anywhere: a meeting is as often titled by its subject —
        // "Meridian Robotics check-in — 14 April 2026" — as by who was in it.
        const everything = normalise(`${label} ${candidate.summary} ${candidate.body}`);
        return meeting.attendees.some((attendee) => everything.includes(normalise(attendee.name)));
      });
      return { record: meeting.record, day: meeting.day, title: meeting.title, page: page?.path };
    });

  const injections: InjectionResult[] = expectations.injections
    .filter((injection) => injection.day <= day)
    .map((injection) => ({
      ...injection,
      pages: pages.filter((page) => {
        const haystack = normalise(`${page.title} ${page.summary} ${page.body}`);
        return injection.phrases.some((phrase) => haystack.includes(normalise(phrase)));
      }).map((page) => page.path),
    }));

  const folders = Object.fromEntries(TAXONOMY
    .map((top) => [top, [...entityFolders(pages, top).keys()].sort()] as const)
    .filter(([, names]) => names.length > 0));

  return { day, pageCount: pages.length, people, meetings, injections, folders };
}
