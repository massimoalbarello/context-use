export type SubjectKind = "person" | "organization" | "meeting" | "event" | "durable";

export type TextTerms = {
  /** Every term must occur after case and punctuation normalization. */
  all?: string[];
  /** At least one term must occur after case and punctuation normalization. */
  any?: string[];
};

export type SubjectDefinition = {
  kind: SubjectKind;
  names: string[];
  aliases?: string[];
  concepts?: string[];
  date?: string;
  participants?: string[];
  organizations?: string[];
  about?: string[];
};

type SubjectInput = Omit<SubjectDefinition, "kind">;
type NamedSubjectInput = Pick<SubjectInput, "names"> & Partial<Omit<SubjectInput, "names">>;
type OccurrenceInput = Pick<SubjectInput, "date"> & Partial<Omit<SubjectInput, "date">>;

export const person = (input: NamedSubjectInput): SubjectDefinition => ({ kind: "person", ...input });
export const organization = (input: NamedSubjectInput): SubjectDefinition => ({ kind: "organization", ...input });
export const durableSubject = (input: NamedSubjectInput): SubjectDefinition => ({ kind: "durable", ...input });
export const meeting = (input: OccurrenceInput): SubjectDefinition => ({ kind: "meeting", names: [], ...input });
export const event = (input: OccurrenceInput): SubjectDefinition => ({ kind: "event", names: [], ...input });

export type ScoreDimension =
  | "tool-engagement"
  | "identity"
  | "placement"
  | "facts"
  | "relationships"
  | "occurrences"
  | "timelines"
  | "reconciliation"
  | "hygiene";

type ExpectationBase = {
  id: string;
  dimension: ScoreDimension;
  weight?: number;
};

export type StoryExpectation =
  | (ExpectationBase & { kind: "exists"; subject: string })
  | (ExpectationBase & { kind: "created"; subject: string })
  | (ExpectationBase & { kind: "updated"; subject: string })
  | (ExpectationBase & { kind: "unique"; subject: string })
  | (ExpectationBase & { kind: "view"; subject: string; view: "intro" | "prep" })
  | (ExpectationBase & { kind: "linked"; from: string; to: string })
  | (ExpectationBase & { kind: "relationship"; from: string; to: string; terms?: TextTerms })
  | (ExpectationBase & { kind: "fact"; subject: string; terms: TextTerms })
  | (ExpectationBase & {
    kind: "timeline";
    subject: string;
    date: string;
    occurrence?: string;
    terms?: TextTerms;
  })
  | (ExpectationBase & {
    kind: "no-occurrence";
    occurrenceKind: "meeting" | "event";
    date: string;
    terms?: TextTerms;
  })
  | (ExpectationBase & {
    kind: "tool-stage";
    stage: "any-context-use" | "guidance" | "mutation-attempted" | "mutation-succeeded";
  });

export const exists = (subject: string): StoryExpectation => ({
  kind: "exists", subject, id: `exists.${subject}`, dimension: "identity",
});
export const created = (subject: string): StoryExpectation => ({
  kind: "created", subject, id: `created.${subject}`, dimension: "reconciliation",
});
export const updated = (subject: string): StoryExpectation => ({
  kind: "updated", subject, id: `updated.${subject}`, dimension: "reconciliation",
});
export const unique = (subject: string): StoryExpectation => ({
  kind: "unique", subject, id: `unique.${subject}`, dimension: "hygiene",
});
export const hasView = (subject: string, view: "intro" | "prep"): StoryExpectation => ({
  kind: "view", subject, view, id: `view.${subject}.${view}`, dimension: "occurrences",
});
export const linked = (from: string, to: string): StoryExpectation => ({
  kind: "linked", from, to, id: `linked.${from}.${to}`, dimension: "relationships",
});
export const relationship = (
  from: string,
  to: string,
  terms?: TextTerms,
): StoryExpectation => ({
  kind: "relationship", from, to, terms,
  id: `relationship.${from}.${to}`, dimension: "relationships",
});
export const fact = (subject: string, terms: TextTerms): StoryExpectation => ({
  kind: "fact", subject, terms, id: `fact.${subject}.${[...(terms.all ?? []), ...(terms.any ?? [])].join("-")}`,
  dimension: "facts",
});
export const timelineEvent = (
  subject: string,
  input: { date: string; occurrence?: string; terms?: TextTerms },
): StoryExpectation => ({
  kind: "timeline", subject, ...input,
  id: `timeline.${subject}.${input.date}${input.occurrence ? `.${input.occurrence}` : ""}`,
  dimension: "timelines",
});
export const noOccurrence = (
  occurrenceKind: "meeting" | "event",
  date: string,
  terms?: TextTerms,
): StoryExpectation => ({
  kind: "no-occurrence", occurrenceKind, date, terms,
  id: `no-${occurrenceKind}.${date}`, dimension: "hygiene",
});
export const toolStage = (
  stage: "any-context-use" | "guidance" | "mutation-attempted" | "mutation-succeeded",
): StoryExpectation => ({
  kind: "tool-stage", stage, id: `tool.${stage}`, dimension: "tool-engagement",
});

export type StoryTurn = {
  id: string;
  date: string;
  user: string;
  expect: StoryExpectation[];
};

export type EvalStory = {
  id: string;
  title: string;
  description: string;
  /** Null suppresses suite context; a string supplies story-specific context. */
  conversationPrelude?: string | null;
  subjects: Record<string, SubjectDefinition>;
  turns: StoryTurn[];
};

export type EvalStorySuite = {
  id: string;
  title: string;
  description: string;
  /** Sent once to the first selected story that does not suppress or override it. */
  conversationPrelude: string;
  stories: EvalStory[];
  /** Story ids in chronological order for a persistent-knowledge journey. */
  journey: string[];
};

export type ToolCallRecord = {
  tool: string;
  status: "attempted" | "succeeded" | "failed";
  arguments?: Record<string, unknown>;
};

export type TurnToolActivity = {
  calls: ToolCallRecord[];
  anyContextUse: boolean;
  guidancePrepared: boolean;
  mutationAttempted: boolean;
  mutationSucceeded: boolean;
};

export function story(input: EvalStory): EvalStory {
  return input;
}

export function suite(input: EvalStorySuite): EvalStorySuite {
  return input;
}
