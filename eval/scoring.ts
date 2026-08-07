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
  const diaryPath = `about/diary/${step.date.replaceAll("-", "/")}/log`;
  const diary = pageAt(pages, diaryPath);

  add(assertions, "diary.exists", Boolean(diary), `Daily diary exists at ${diaryPath}`);

  for (const entity of step.entities) {
    const introPath = `${entity.path}/intro`;
    const timelinePath = `${entity.path}/timeline`;
    const intro = pageAt(pages, introPath);
    const timeline = pageAt(pages, timelinePath);
    const previousIntro = pageAt(previousPages, introPath);
    const previousTimeline = pageAt(previousPages, timelinePath);

    add(assertions, `${entity.path}.intro`, Boolean(intro), `${entity.label} has a canonical intro page`);
    add(assertions, `${entity.path}.timeline`, Boolean(timeline), `${entity.label} has its own timeline`);
    add(
      assertions,
      `${entity.path}.intro-reconciled`,
      intro !== undefined && (!previousIntro || intro.version > previousIntro.version),
      `${entity.label}'s canonical account was ${previousIntro ? "updated" : "created"} for this step`,
      intro ? `${intro.path} v${intro.version}` : undefined,
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
      `${entity.path}.diary-backlink`,
      linksTo(timeline, diaryPath),
      `${entity.label}'s timeline links the exact daily diary`,
      timeline?.path,
    );
    add(
      assertions,
      `diary.${entity.path}`,
      linksTo(diary, introPath),
      `The daily diary links ${entity.label}`,
      diary?.path,
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
      add(
        assertions,
        "diary.meeting-link",
        linksTo(diary, meeting.path),
        "The daily diary links the canonical meeting",
        meeting.path,
      );
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
