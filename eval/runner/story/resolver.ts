import {
  candidateLinksTo,
  termsScore,
  textHasDate,
  type GraphCandidate,
  type KnowledgeGraph,
} from "./graph.ts";
import type { SubjectDefinition } from "./types.ts";

export type CandidateMatch = {
  candidate: GraphCandidate;
  confidence: number;
  evidence: string[];
};

export type SubjectResolution = {
  subject: string;
  status: "resolved" | "ambiguous" | "missing";
  confidence: number;
  candidate?: GraphCandidate;
  alternatives: CandidateMatch[];
};

export type StoryResolution = {
  subjects: Map<string, SubjectResolution>;
  bindings: Map<string, string>;
};

const RESOLUTION_THRESHOLD = 0.38;
const UNIQUE_MATCH_THRESHOLD = 0.55;

function nameScore(candidate: GraphCandidate, definition: SubjectDefinition): number {
  const names = [...definition.names, ...(definition.aliases ?? [])];
  if (names.length === 0) return 1;
  // People, organizations and occurrences identify themselves through their stable path and
  // title. Summaries describe relationships, so using them as identity evidence can make a
  // Microsoft folder an equally good Apple candidate. A durable subject may also validly be
  // one independently retrievable aspect page, whose body is its identity evidence.
  const identityText = definition.kind === "durable" && candidate.nodeType === "page"
    ? [candidate.path, candidate.title, candidate.summary, candidate.text]
    : [candidate.path, candidate.title];
  return termsScore(identityText.join(" "), { any: names });
}

function placementScore(candidate: GraphCandidate, definition: SubjectDefinition): number {
  if (definition.kind === "durable") {
    if (candidate.nodeType === "page") return 1;
    return candidate.placement === "other" ? 1 : 0.65;
  }
  if (candidate.placement === definition.kind) return 1;
  // A misclassified occurrence still retains some discoverability credit.
  if ((definition.kind === "meeting" && candidate.placement === "event")
    || (definition.kind === "event" && candidate.placement === "meeting")) return 0.35;
  return 0;
}

function referenceIds(definition: SubjectDefinition): string[] {
  return [
    ...(definition.participants ?? []),
    ...(definition.organizations ?? []),
    ...(definition.about ?? []),
  ];
}

function requiredIdentity(
  candidate: GraphCandidate,
  definition: SubjectDefinition,
): boolean {
  const names = [...definition.names, ...(definition.aliases ?? [])];
  if ((definition.kind === "person" || definition.kind === "organization"
    || definition.kind === "durable") && names.length && nameScore(candidate, definition) === 0) {
    return false;
  }
  if ((definition.kind === "meeting" || definition.kind === "event") && definition.date
    && !textHasDate(`${candidate.path}\n${candidate.text}`, definition.date)) {
    return false;
  }
  // A misplaced occurrence remains discoverable for separate placement scoring, but only
  // when its own metadata names the occurrence rather than merely mentioning it in prose.
  if ((definition.kind === "meeting" || definition.kind === "event")
    && candidate.placement !== definition.kind && names.length
    && nameScore(candidate, definition) === 0) {
    return false;
  }
  return true;
}

function candidateScore(
  candidate: GraphCandidate,
  definition: SubjectDefinition,
  resolved: Map<string, SubjectResolution>,
): CandidateMatch {
  const components: { score: number; weight: number; label: string }[] = [
    { score: placementScore(candidate, definition), weight: 0.2, label: "placement" },
  ];
  if (definition.names.length || definition.aliases?.length) {
    components.push({ score: nameScore(candidate, definition), weight: 0.35, label: "name" });
  }
  if (definition.date) {
    components.push({
      score: textHasDate(`${candidate.path}\n${candidate.text}`, definition.date) ? 1 : 0,
      weight: 0.2,
      label: "date",
    });
  }
  if (definition.concepts?.length) {
    components.push({
      score: termsScore(candidate.text, { all: definition.concepts }),
      weight: 0.15,
      label: "concepts",
    });
  }
  const references = referenceIds(definition)
    .flatMap((id) => resolved.get(id)?.candidate ?? []);
  if (references.length) {
    components.push({
      score: references.filter((target) => candidateLinksTo(candidate, target)).length / references.length,
      weight: 0.25,
      label: "links",
    });
  }
  const weight = components.reduce((total, component) => total + component.weight, 0);
  const confidence = components.reduce((total, component) => total + component.score * component.weight, 0) / weight;
  return {
    candidate,
    confidence,
    evidence: components.map((component) => `${component.label} ${component.score.toFixed(2)}`),
  };
}

function eligible(candidate: GraphCandidate, definition: SubjectDefinition): boolean {
  if (definition.kind !== "durable") return candidate.nodeType === "directory";
  if (candidate.nodeType === "page") return true;
  return candidate.placement === "other" && !candidate.path.startsWith("about/diary/");
}

function selectedDefinitions(
  definitions: Record<string, SubjectDefinition>,
  requested?: Iterable<string>,
): Array<[string, SubjectDefinition]> {
  if (!requested) return Object.entries(definitions);
  const selected = new Set(requested);
  const pending = [...selected];
  while (pending.length) {
    const definition = definitions[pending.pop()!];
    if (!definition) continue;
    for (const reference of referenceIds(definition)) {
      if (selected.has(reference)) continue;
      selected.add(reference);
      pending.push(reference);
    }
  }
  return Object.entries(definitions).filter(([subject]) => selected.has(subject));
}

const KIND_ORDER: Record<SubjectDefinition["kind"], number> = {
  person: 0,
  organization: 1,
  durable: 2,
  meeting: 3,
  event: 4,
};

export function resolveStorySubjects(
  graph: KnowledgeGraph,
  definitions: Record<string, SubjectDefinition>,
  previousBindings: Map<string, string> = new Map(),
  requestedSubjects?: Iterable<string>,
): StoryResolution {
  const subjects = new Map<string, SubjectResolution>();
  const bindings = new Map(previousBindings);
  const active = selectedDefinitions(definitions, requestedSubjects);
  const activeIds = new Set(active.map(([subject]) => subject));
  const used = new Set([...bindings.entries()]
    .flatMap(([subject, candidateId]) => activeIds.has(subject) ? [] : [candidateId]));
  const ordered = active
    .sort(([, left], [, right]) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind]);

  for (const [subject, definition] of ordered) {
    const boundId = bindings.get(subject);
    const bound = boundId ? graph.byId.get(boundId) : undefined;
    if (bound) {
      used.add(bound.id);
      subjects.set(subject, {
        subject, status: "resolved", confidence: 1, candidate: bound, alternatives: [],
      });
      continue;
    }

    const ranked = graph.candidates
      .filter((candidate) => eligible(candidate, definition)
        && requiredIdentity(candidate, definition)
        && !used.has(candidate.id))
      .map((candidate) => candidateScore(candidate, definition, subjects))
      .sort((left, right) => right.confidence - left.confidence
        || left.candidate.path.localeCompare(right.candidate.path));
    const [best, second] = ranked;
    if (!best || best.confidence < RESOLUTION_THRESHOLD) {
      subjects.set(subject, {
        subject, status: "missing", confidence: best?.confidence ?? 0, alternatives: ranked.slice(0, 3),
      });
      continue;
    }
    if (second && second.confidence >= RESOLUTION_THRESHOLD
      && best.confidence - second.confidence <= 0.05) {
      subjects.set(subject, {
        subject, status: "ambiguous", confidence: best.confidence, alternatives: ranked.slice(0, 3),
      });
      continue;
    }
    used.add(best.candidate.id);
    bindings.set(subject, best.candidate.id);
    subjects.set(subject, {
      subject,
      status: "resolved",
      confidence: best.confidence,
      candidate: best.candidate,
      alternatives: ranked.slice(1, 3),
    });
  }
  return { subjects, bindings };
}

export function candidateMatches(
  graph: KnowledgeGraph,
  definition: SubjectDefinition,
  resolutions: Map<string, SubjectResolution>,
): CandidateMatch[] {
  return graph.candidates
    .filter((candidate) => eligible(candidate, definition)
      && requiredIdentity(candidate, definition)
      && (definition.kind === "durable" || candidate.placement === definition.kind))
    .map((candidate) => candidateScore(candidate, definition, resolutions))
    .filter((match) => match.confidence >= UNIQUE_MATCH_THRESHOLD)
    .sort((left, right) => right.confidence - left.confidence);
}
