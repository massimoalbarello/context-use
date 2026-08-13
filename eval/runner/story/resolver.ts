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

function nameScore(candidate: GraphCandidate, definition: SubjectDefinition): number {
  const names = [...definition.names, ...(definition.aliases ?? [])];
  if (names.length === 0) return 1;
  // People, organizations, and occurrences must identify themselves at their entry point;
  // merely mentioning Apple in another company's prose must not make that company an Apple
  // duplicate. A durable subject may validly be one section of a generic aspect page, so
  // its body is identity evidence too.
  const identityText = definition.kind === "durable"
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
  if (definition.kind === "durable") return true;
  return candidate.nodeType === "directory";
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
): StoryResolution {
  const subjects = new Map<string, SubjectResolution>();
  const bindings = new Map(previousBindings);
  const used = new Set<string>();
  const ordered = Object.entries(definitions)
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
      .filter((candidate) => eligible(candidate, definition) && !used.has(candidate.id))
      .map((candidate) => candidateScore(candidate, definition, subjects))
      .sort((left, right) => right.confidence - left.confidence || left.candidate.path.localeCompare(right.candidate.path));
    const [best, second] = ranked;
    if (!best || best.confidence < 0.38) {
      subjects.set(subject, {
        subject, status: "missing", confidence: best?.confidence ?? 0, alternatives: ranked.slice(0, 3),
      });
      continue;
    }
    if (second && second.confidence >= 0.38 && best.confidence - second.confidence <= 0.05) {
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
    .filter((candidate) => eligible(candidate, definition))
    .map((candidate) => candidateScore(candidate, definition, resolutions))
    .filter((match) => match.confidence >= 0.38)
    .sort((left, right) => right.confidence - left.confidence);
}
