import type { EvalStep } from "./scenarios/amara-novamind.ts";
import type { PageSnapshot } from "./snapshot.ts";

export type { PageSnapshot } from "./snapshot.ts";

export type AssertionResult = {
  id: string;
  passed: boolean;
  message: string;
  evidence?: string;
};

export type StepScore = {
  stepId: string;
  passed: number;
  total: number;
  assertions: AssertionResult[];
};

function pageAt(pages: PageSnapshot[], path: string): PageSnapshot | undefined {
  return pages.find((page) => page.path === path);
}

function linksTo(page: PageSnapshot | undefined, path: string): boolean {
  if (!page) return false;
  const targets = path.endsWith("/intro") ? [path, path.slice(0, -"/intro".length)] : [path];
  return targets.some((target) => {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\[\\[${escaped}(?:[#|\\]])`, "i").test(page.body);
  });
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function diaryPathFor(date: string): string {
  return `about/diary/${date.replaceAll("-", "/")}/intro`;
}

function wikilinkTargets(page: PageSnapshot): string[] {
  return [...page.body.matchAll(/\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/g)]
    .map((match) => match[1]!.split("#", 1)[0]!);
}

/** Day pages reachable from the intro form one small hypermedia; orphaned views do not count. */
function reachableDiaryPages(pages: PageSnapshot[], date: string): PageSnapshot[] {
  const introPath = diaryPathFor(date);
  const dayPrefix = `${introPath.slice(0, -"/intro".length)}/`;
  const byPath = new Map(pages
    .filter((page) => page.path.startsWith(dayPrefix))
    .map((page) => [page.path, page]));
  const intro = byPath.get(introPath);
  if (!intro) return [];

  const reachable: PageSnapshot[] = [];
  const pending = [intro];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const page = pending.shift()!;
    if (seen.has(page.path)) continue;
    seen.add(page.path);
    reachable.push(page);
    for (const target of wikilinkTargets(page)) {
      const linked = byPath.get(target);
      if (linked && !seen.has(linked.path)) pending.push(linked);
    }
  }
  return reachable;
}

/** The root guide's entry shape: `- **9 August** — …` under a year and month heading. */
function hasDatedEntry(page: PageSnapshot | undefined, date: string): boolean {
  if (!page) return false;
  const [, month, day] = date.split("-");
  const label = `${Number(day)} ${MONTHS[Number(month) - 1]}`;
  return new RegExp(`\\*\\*${label}\\*\\*`, "i").test(page.body);
}

function mentionsDiary(page: PageSnapshot | undefined): boolean {
  return page ? /\[\[about\/diary\//i.test(page.body) : false;
}

const MONTH_PATTERN = MONTHS.join("|");
const DATE_PATTERN = new RegExp(
  `\\b(?:\\d{1,2} )?(?:${MONTH_PATTERN})(?: \\d{4})?\\b|\\bQ[1-4](?: \\d{4})?\\b`,
  "gi",
);

/**
 * A canonical page carries one kind of date only: an inline `— as of <date>` on a durable
 * fact that can change. Any other date is a status, stage or figure that belongs on the
 * timeline. Returns the offending fragments so a failure names what to move.
 */
function undatedStatus(page: PageSnapshot | undefined): string[] {
  if (!page) return [];
  return [...page.body.matchAll(DATE_PATTERN)]
    .filter((match) => !/as of\s*$/i.test(page.body.slice(Math.max(0, match.index - 8), match.index)))
    .map((match) => match[0]);
}

function add(
  assertions: AssertionResult[],
  id: string,
  passed: boolean,
  message: string,
  evidence?: string,
): void {
  assertions.push({ id, passed, message, ...(evidence ? { evidence } : {}) });
}

function findMeeting(pages: PageSnapshot[], date: string, entityPaths: string[]): PageSnapshot | undefined {
  const [year, month] = date.split("-");
  const prefix = `meetings/${year}/${month}/${date}_`;
  return pages.find((page) => page.path.startsWith(prefix)
    && page.path.endsWith("/intro")
    && entityPaths.some((path) => linksTo(page, `${path}/intro`)));
}

export function scoreStep(
  step: EvalStep,
  pages: PageSnapshot[],
  previousPages: PageSnapshot[] = [],
): StepScore {
  const assertions: AssertionResult[] = [];

  for (const entity of step.entities) {
    const introPath = `${entity.path}/intro`;
    const timelinePath = `${entity.path}/timeline`;
    const intro = pageAt(pages, introPath);
    const timeline = pageAt(pages, timelinePath);
    const previousTimeline = pageAt(previousPages, timelinePath);

    add(assertions, `${entity.path}.intro`, Boolean(intro), `${entity.label} has a canonical intro page`);
    add(assertions, `${entity.path}.timeline`, Boolean(timeline), `${entity.label} has its own timeline`);
    const dated = undatedStatus(intro);
    add(
      assertions,
      `${entity.path}.intro-undated`,
      intro !== undefined && dated.length === 0,
      `${entity.label}'s canonical account carries no date outside an "as of" fact`,
      dated.join(", ") || undefined,
    );
    add(
      assertions,
      `${entity.path}.timeline-reconciled`,
      timeline !== undefined && (!previousTimeline || timeline.version > previousTimeline.version),
      `${entity.label}'s timeline was ${previousTimeline ? "updated" : "created"} for this step`,
      timeline ? `${timeline.path} v${timeline.version}` : undefined,
    );
    add(
      assertions,
      `${entity.path}.timeline-dated`,
      hasDatedEntry(timeline, step.date),
      `${entity.label}'s timeline carries an entry dated ${step.date}`,
      timeline?.path,
    );
    add(
      assertions,
      `${entity.path}.no-diary-link`,
      !mentionsDiary(timeline),
      `${entity.label}'s timeline links no diary page; the composer owns that direction`,
      timeline?.path,
    );

    const duplicateIntros = pages.filter((page) => page.path.startsWith(`${entity.path}-`)
      && page.path.endsWith("/intro"));
    add(
      assertions,
      `${entity.path}.unique`,
      duplicateIntros.length === 0,
      `${entity.label} was reconciled into one canonical entity`,
      duplicateIntros.map((page) => page.path).join(", ") || undefined,
    );

    if (entity.companyPath) {
      add(
        assertions,
        `${entity.path}.company-link`,
        linksTo(intro, `${entity.companyPath}/intro`),
        `${entity.label}'s canonical account links the company in context`,
        intro?.path,
      );
      add(
        assertions,
        `${entity.companyPath}.${entity.path}.link`,
        linksTo(pageAt(pages, `${entity.companyPath}/intro`), introPath),
        `The company account links ${entity.label} in context`,
        `${entity.companyPath}/intro`,
      );
    }

    for (const linkedEntityPath of entity.linkedEntityPaths ?? []) {
      add(
        assertions,
        `${entity.path}.link.${linkedEntityPath}`,
        linksTo(intro, `${linkedEntityPath}/intro`),
        `${entity.label}'s canonical account links ${linkedEntityPath} in context`,
        intro?.path,
      );
    }
  }

  if (step.meetingExpected) {
    const meeting = findMeeting(pages, step.date, step.entities.map((entity) => entity.path));
    add(assertions, "meeting.exists", Boolean(meeting), `A canonical meeting account exists for ${step.date}`);
    if (meeting) {
      for (const entity of step.entities) {
        add(
          assertions,
          `meeting.${entity.path}`,
          linksTo(meeting, `${entity.path}/intro`),
          `The meeting links ${entity.label}`,
          meeting.path,
        );
        add(
          assertions,
          `${entity.path}.meeting-link`,
          linksTo(pageAt(pages, `${entity.path}/timeline`), meeting.path),
          `${entity.label}'s timeline links the meeting occurrence`,
          `${entity.path}/timeline`,
        );
      }
    }
  }

  return {
    stepId: step.id,
    passed: assertions.filter((assertion) => assertion.passed).length,
    total: assertions.length,
    assertions,
  };
}

/**
 * The diary is composed after the fact by the diary composer, not written by the agent
 * that recorded the events. It is therefore scored once, over the final snapshot, by
 * walking the day's connected views in the direction the links run: diary → entity.
 */
export function scoreDiary(steps: EvalStep[], pages: PageSnapshot[]): StepScore {
  const assertions: AssertionResult[] = [];

  for (const date of [...new Set(steps.map((step) => step.date))].sort()) {
    const diaryPath = diaryPathFor(date);
    const diary = pageAt(pages, diaryPath);
    add(assertions, `diary.${date}.exists`, Boolean(diary), `Daily diary exists at ${diaryPath}`);
    const dayPages = reachableDiaryPages(pages, date);
    const dayEvidence = dayPages.map((page) => page.path).join(", ") || undefined;

    const entities = steps
      .filter((step) => step.date === date)
      .flatMap((step) => step.entities);
    for (const entity of entities) {
      add(
        assertions,
        `diary.${date}.${entity.path}`,
        dayPages.some((page) => linksTo(page, `${entity.path}/intro`)),
        `The ${date} diary hypermedia links ${entity.label}`,
        dayEvidence,
      );
    }

    for (const step of steps.filter((candidate) => candidate.date === date && candidate.meetingExpected)) {
      const meeting = findMeeting(pages, date, step.entities.map((entity) => entity.path));
      add(
        assertions,
        `diary.${date}.meeting-link`,
        Boolean(meeting) && dayPages.some((page) => linksTo(page, meeting!.path)),
        `The ${date} diary hypermedia links the canonical meeting`,
        dayEvidence,
      );
    }
  }

  return {
    stepId: "diary-composer",
    passed: assertions.filter((assertion) => assertion.passed).length,
    total: assertions.length,
    assertions,
  };
}
