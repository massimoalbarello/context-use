import {
  candidateChanged,
  candidateLinksTo,
  linkedContexts,
  textLinksTo,
  termsScore,
  textHasDate,
  type GraphCandidate,
  type KnowledgeGraph,
} from "./graph.ts";
import { candidateMatches, type StoryResolution, type SubjectResolution } from "./resolver.ts";
import type {
  EvalStory,
  ScoreDimension,
  StoryExpectation,
  StoryTurn,
  SubjectDefinition,
  TurnToolActivity,
} from "./types.ts";

export type AssertionScore = {
  id: string;
  dimension: ScoreDimension;
  score: number;
  weight: number;
  message: string;
  evidence?: string;
};

export type DimensionScore = {
  dimension: ScoreDimension;
  score: number;
  earned: number;
  possible: number;
};

export type TurnScore = {
  turnId: string;
  score: number;
  assertions: AssertionScore[];
  dimensions: DimensionScore[];
};

export type StoryScore = {
  storyId: string;
  score: number;
  turns: TurnScore[];
  dimensions: DimensionScore[];
};

function resolutionCredit(resolution: SubjectResolution | undefined): number {
  if (resolution?.status === "resolved") return 1;
  if (resolution?.status === "ambiguous") return 0.5;
  return 0;
}

function candidate(resolution: StoryResolution, subject: string): GraphCandidate | undefined {
  return resolution.subjects.get(subject)?.candidate;
}

function evidenceFor(resolution: SubjectResolution | undefined): string | undefined {
  if (!resolution) return undefined;
  if (resolution.candidate) return `${resolution.candidate.path} (${resolution.confidence.toFixed(2)})`;
  const alternatives = resolution.alternatives.map((match) =>
    `${match.candidate.path} (${match.confidence.toFixed(2)})`);
  return alternatives.join(", ") || undefined;
}

function expectationSubjects(expectation: StoryExpectation): string[] {
  if (expectation.kind === "exists" || expectation.kind === "created"
    || expectation.kind === "updated" || expectation.kind === "unique"
    || expectation.kind === "view" || expectation.kind === "fact") {
    return [expectation.subject];
  }
  if (expectation.kind === "timeline") {
    return [expectation.subject, ...(expectation.occurrence ? [expectation.occurrence] : [])];
  }
  if (expectation.kind === "linked" || expectation.kind === "relationship") {
    return [expectation.from, expectation.to];
  }
  return [];
}

function placementAssertion(
  subject: string,
  definition: SubjectDefinition,
  resolution: SubjectResolution | undefined,
): AssertionScore | undefined {
  // Durable works and products may validly be their own entity folder or an independently
  // retrievable aspect inside another entity. The default template does prescribe homes
  // for these four first-class kinds.
  if (definition.kind === "durable") return undefined;
  const candidates = resolution?.status === "resolved" && resolution.candidate
    ? [resolution.candidate]
    : resolution?.status === "ambiguous"
      ? resolution.alternatives
        .filter((alternative) => alternative.confidence >= 0.38)
        .map((alternative) => alternative.candidate)
      : [];
  const correctlyPlaced = candidates.length > 0
    && candidates.every((candidate) => candidate.placement === definition.kind);
  return {
    id: `home.${subject}`,
    dimension: "placement",
    score: correctlyPlaced ? 1 : 0,
    weight: 1,
    message: `${subject} lives in the template's ${definition.kind} subtree`,
    evidence: candidates.map((candidate) => candidate.path).join(", ") || undefined,
  };
}

function timelineScore(
  subject: GraphCandidate | undefined,
  graph: KnowledgeGraph,
  date: string,
  occurrence: GraphCandidate | undefined,
  terms: Extract<StoryExpectation, { kind: "timeline" }>["terms"],
): { score: number; evidence?: string } {
  if (!subject) return { score: 0 };
  const directTimeline = subject.pages.find((page) => page.path.endsWith("/timeline"));
  // An independently retrievable aspect page can be the canonical home for a product or
  // partnership without owning a folder. In that valid shape its chronology belongs to the
  // containing entity's timeline.
  const owner = subject.nodeType === "page"
    ? graph.candidates.find((candidate) => candidate.nodeType === "directory"
      && candidate.pages.some((page) => subject.pages.some((subjectPage) => subjectPage.id === page.id)))
    : undefined;
  const timeline = directTimeline ?? owner?.pages.find((page) => page.path.endsWith("/timeline"));
  if (!timeline) return { score: 0, evidence: `${subject.path} has no timeline` };
  const datedLines = timeline.body.split("\n").filter((line) => textHasDate(line, date));
  if (datedLines.length === 0) return { score: 0, evidence: timeline.path };
  const best = datedLines
    .map((line) => {
      const pieces = [1];
      if (occurrence) pieces.push(textLinksTo(line, occurrence) ? 1 : 0);
      if (terms) pieces.push(termsScore(line, terms));
      return { line, score: pieces.reduce((total, piece) => total + piece, 0) / pieces.length };
    })
    .sort((left, right) => right.score - left.score)[0]!;
  return { score: best.score, evidence: `${timeline.path}: ${best.line.trim()}` };
}

function toolStageScore(activity: TurnToolActivity, stage: Extract<StoryExpectation, { kind: "tool-stage" }>["stage"]): boolean {
  if (stage === "any-context-use") return activity.anyContextUse;
  if (stage === "guidance") return activity.guidancePrepared;
  if (stage === "mutation-attempted") return activity.mutationAttempted;
  return activity.mutationSucceeded;
}

function scoreExpectation(
  expectation: StoryExpectation,
  story: EvalStory,
  before: KnowledgeGraph,
  after: KnowledgeGraph,
  resolution: StoryResolution,
  activity: TurnToolActivity,
): AssertionScore {
  const weight = expectation.weight ?? 1;
  const result = (score: number, message: string, evidence?: string): AssertionScore => ({
    id: expectation.id,
    dimension: expectation.dimension,
    score: Math.max(0, Math.min(1, score)),
    weight,
    message,
    ...(evidence ? { evidence } : {}),
  });

  if (expectation.kind === "tool-stage") {
    return result(
      toolStageScore(activity, expectation.stage) ? 1 : 0,
      `Context Use reached the ${expectation.stage} stage`,
      activity.calls.map((call) => `${call.tool}:${call.status}`).join(", ") || undefined,
    );
  }
  if (expectation.kind === "no-occurrence") {
    const matches = after.candidates.filter((candidate) =>
      candidate.nodeType === "directory"
      && candidate.placement === expectation.occurrenceKind
      && textHasDate(`${candidate.path}\n${candidate.text}`, expectation.date)
      && termsScore(candidate.text, expectation.terms) >= 0.75);
    return result(
      matches.length === 0 ? 1 : 1 / (matches.length + 1),
      `No unsupported ${expectation.occurrenceKind} was created for ${expectation.date}`,
      matches.map((match) => match.path).join(", ") || undefined,
    );
  }

  if (expectation.kind === "exists") {
    const found = resolution.subjects.get(expectation.subject);
    return result(
      resolutionCredit(found),
      `${expectation.subject} resolves to a durable knowledge subject`,
      evidenceFor(found),
    );
  }
  if (expectation.kind === "created") {
    const found = resolution.subjects.get(expectation.subject);
    const current = found?.candidate;
    const existed = current ? before.byId.has(current.id) : false;
    const score = current ? 1 : resolutionCredit(found) * 0.25;
    return result(
      score,
      existed
        ? `${expectation.subject} was reused without duplication`
        : `${expectation.subject} was created in this turn`,
      evidenceFor(found),
    );
  }
  if (expectation.kind === "updated") {
    const current = candidate(resolution, expectation.subject);
    const previous = current ? before.byId.get(current.id) : undefined;
    return result(
      candidateChanged(previous, current) ? 1 : 0,
      `${expectation.subject} retained its identity and was updated`,
      current?.path,
    );
  }
  if (expectation.kind === "unique") {
    const definition = story.subjects[expectation.subject];
    const matches = definition ? candidateMatches(after, definition, resolution.subjects) : [];
    const count = matches.length;
    return result(
      count === 1 ? 1 : count > 1 ? 1 / count : 0,
      `${expectation.subject} has one canonical match`,
      matches.map((match) => `${match.candidate.path} (${match.confidence.toFixed(2)})`).join(", ") || undefined,
    );
  }
  if (expectation.kind === "view") {
    const found = candidate(resolution, expectation.subject);
    const page = found?.pages.find((candidatePage) => candidatePage.path.endsWith(`/${expectation.view}`));
    return result(Boolean(page) ? 1 : 0, `${expectation.subject} has a ${expectation.view} view`, page?.path ?? found?.path);
  }
  if (expectation.kind === "linked") {
    const from = candidate(resolution, expectation.from);
    const to = candidate(resolution, expectation.to);
    return result(
      from && to && candidateLinksTo(from, to) ? 1 : 0,
      `${expectation.from} links ${expectation.to}`,
      from && to ? `${from.path} → ${to.path}` : undefined,
    );
  }
  if (expectation.kind === "relationship") {
    const from = candidate(resolution, expectation.from);
    const to = candidate(resolution, expectation.to);
    const contexts = from && to ? linkedContexts(from, to) : [];
    const linkCredit = contexts.length ? 1 : 0;
    const contextCredit = expectation.terms && contexts.length
      ? Math.max(...contexts.map((context) => termsScore(context, expectation.terms)))
      : linkCredit;
    return result(
      expectation.terms ? (linkCredit + contextCredit) / 2 : linkCredit,
      `${expectation.from} describes its relationship with ${expectation.to}`,
      contexts[0]?.trim() ?? (from && to ? `${from.path} → ${to.path}` : undefined),
    );
  }
  if (expectation.kind === "fact") {
    const found = candidate(resolution, expectation.subject);
    return result(
      found ? termsScore(found.text, expectation.terms) : 0,
      `${expectation.subject} carries the expected fact`,
      found?.path,
    );
  }
  const subject = candidate(resolution, expectation.subject);
  const occurrence = expectation.occurrence ? candidate(resolution, expectation.occurrence) : undefined;
  const scored = timelineScore(subject, after, expectation.date, occurrence, expectation.terms);
  return result(
    scored.score,
    `${expectation.subject}'s timeline records ${expectation.date}`,
    scored.evidence,
  );
}

function aggregateDimensions(assertions: AssertionScore[]): DimensionScore[] {
  const dimensions = new Map<ScoreDimension, { earned: number; possible: number }>();
  for (const assertion of assertions) {
    const current = dimensions.get(assertion.dimension) ?? { earned: 0, possible: 0 };
    current.earned += assertion.score * assertion.weight;
    current.possible += assertion.weight;
    dimensions.set(assertion.dimension, current);
  }
  return [...dimensions.entries()].map(([dimension, value]) => ({
    dimension,
    earned: value.earned,
    possible: value.possible,
    score: value.possible ? value.earned / value.possible : 0,
  }));
}

export function scoreStoryTurn(input: {
  story: EvalStory;
  turn: StoryTurn;
  before: KnowledgeGraph;
  after: KnowledgeGraph;
  resolution: StoryResolution;
  activity: TurnToolActivity;
}): TurnScore {
  const expectedAssertions = input.turn.expect.map((expectation) => scoreExpectation(
    expectation,
    input.story,
    input.before,
    input.after,
    input.resolution,
    input.activity,
  ));
  const activeSubjects = new Set(input.turn.expect.flatMap(expectationSubjects));
  const placementAssertions = [...activeSubjects].flatMap((subject) => {
    const definition = input.story.subjects[subject];
    if (!definition) return [];
    return placementAssertion(subject, definition, input.resolution.subjects.get(subject)) ?? [];
  });
  const assertions = [...expectedAssertions, ...placementAssertions];
  const possible = assertions.reduce((total, assertion) => total + assertion.weight, 0);
  const earned = assertions.reduce((total, assertion) => total + assertion.score * assertion.weight, 0);
  return {
    turnId: input.turn.id,
    score: possible ? earned / possible : 0,
    assertions,
    dimensions: aggregateDimensions(assertions),
  };
}

export function aggregateStoryScore(storyId: string, turns: TurnScore[]): StoryScore {
  const assertions = turns.flatMap((turn) => turn.assertions);
  const possible = assertions.reduce((total, assertion) => total + assertion.weight, 0);
  const earned = assertions.reduce((total, assertion) => total + assertion.score * assertion.weight, 0);
  return {
    storyId,
    score: possible ? earned / possible : 0,
    turns,
    dimensions: aggregateDimensions(assertions),
  };
}
