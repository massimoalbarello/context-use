import { normalise } from "../text.ts";
import type { DirectorySnapshot, KnowledgeSnapshot, PageSnapshot } from "../snapshot.ts";
import type { SubjectKind, TextTerms } from "./types.ts";

export type GraphCandidate = {
  /** Stable across path and title changes. */
  id: string;
  nodeType: "directory" | "page";
  path: string;
  placement: SubjectKind | "other";
  title: string;
  summary: string;
  text: string;
  pages: PageSnapshot[];
  targetPaths: Set<string>;
  outgoingPaths: Set<string>;
  versions: Map<string, number>;
};

export type KnowledgeGraph = {
  candidates: GraphCandidate[];
  byId: Map<string, GraphCandidate>;
  byTargetPath: Map<string, GraphCandidate[]>;
};

function parentPath(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function placementFor(path: string): SubjectKind | "other" {
  if (/^people\/[^/]+$/.test(path)) return "person";
  if (/^companies\/[^/]+$/.test(path)) return "organization";
  if (/^meetings\/\d{4}\/\d{2}\/[^/]+$/.test(path)) return "meeting";
  if (/^events\/\d{4}\/\d{2}\/[^/]+$/.test(path)) return "event";
  return "other";
}

function internalLinks(body: string): string[] {
  const wikilinks = [...body.matchAll(/\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]*)?\]\]/g)]
    .map((match) => match[1]!.replace(/\/$/, ""));
  const stable = [...body.matchAll(/\]\((context-use:\/\/(?:page|directory)\/[^)#\s]+)(?:#[^)\s]+)?\)/g)]
    .map((match) => match[1]!.toLowerCase());
  return [...wikilinks, ...stable];
}

function scorablePage(page: PageSnapshot): boolean {
  return page.path !== "agents"
    && !page.path.endsWith("/agents")
    && !page.path.startsWith("automations/");
}

function directoryCandidate(directory: DirectorySnapshot, pages: PageSnapshot[]): GraphCandidate | undefined {
  const direct = pages.filter((page) => page.parentDirectoryId === directory.id
    || (!page.parentDirectoryId && parentPath(page.path) === directory.path));
  const authored = direct.filter(scorablePage);
  if (authored.length === 0) return undefined;
  const placement = placementFor(directory.path);
  // Top-level template directories are containers, not possible subjects.
  if (!directory.path.includes("/") && placement === "other") return undefined;
  const outgoingPaths = new Set(authored.flatMap((page) => internalLinks(page.body)));
  const targetPaths = new Set([
    directory.path,
    `context-use://directory/${directory.id.toLowerCase()}`,
    ...authored.flatMap((page) => [page.path, `context-use://page/${page.id.toLowerCase()}`]),
  ]);
  const versions = new Map<string, number>([
    [`directory:${directory.id}`, directory.version],
    ...authored.map((page) => [`page:${page.id}`, page.version] as const),
  ]);
  return {
    id: `directory:${directory.id}`,
    nodeType: "directory",
    path: directory.path,
    placement,
    title: directory.title,
    summary: directory.summary,
    text: [directory.title, directory.summary, ...authored.flatMap((page) => [page.title, page.summary, page.body])]
      .join("\n"),
    pages: authored,
    targetPaths,
    outgoingPaths,
    versions,
  };
}

function pageCandidate(
  page: PageSnapshot,
  owner: GraphCandidate | undefined,
): GraphCandidate | undefined {
  if (!scorablePage(page)) return undefined;
  // Entity entry points and lifecycle/timeline views are already represented by their
  // stable directory candidate. Only independently retrievable aspect pages need a page
  // candidate of their own; otherwise one entity appears as two equally good matches.
  if (/\/(?:intro|timeline|prep)$/.test(page.path)) return undefined;
  // A generic nested entity folder (for example topics/imac/) owns its detail pages. A
  // known entity kind may still contain independently retrievable subjects, such as an
  // organization's products page, so those remain eligible as standalone candidates.
  if (owner?.placement === "other") return undefined;
  return {
    id: `page:${page.id}`,
    nodeType: "page",
    path: page.path,
    placement: "other",
    title: page.title,
    summary: page.summary,
    text: [page.title, page.summary, page.body].join("\n"),
    pages: [page],
    targetPaths: new Set([page.path, `context-use://page/${page.id.toLowerCase()}`]),
    outgoingPaths: new Set(internalLinks(page.body)),
    versions: new Map([[`page:${page.id}`, page.version]]),
  };
}

export function buildKnowledgeGraph(snapshot: KnowledgeSnapshot): KnowledgeGraph {
  const directoryCandidates = snapshot.directories
    .flatMap((directory) => directoryCandidate(directory, snapshot.pages) ?? []);
  const directoryById = new Map(directoryCandidates
    .filter((candidate) => candidate.nodeType === "directory")
    .map((candidate) => [candidate.id.slice("directory:".length), candidate]));
  const candidates = [
    ...directoryCandidates,
    ...snapshot.pages.flatMap((page) => pageCandidate(
      page,
      page.parentDirectoryId ? directoryById.get(page.parentDirectoryId) : undefined,
    ) ?? []),
  ];
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const byTargetPath = new Map<string, GraphCandidate[]>();
  for (const candidate of candidates) {
    for (const path of candidate.targetPaths) {
      const existing = byTargetPath.get(path) ?? [];
      existing.push(candidate);
      byTargetPath.set(path, existing);
    }
  }
  return { candidates, byId, byTargetPath };
}

export function candidateLinksTo(from: GraphCandidate, to: GraphCandidate): boolean {
  return [...to.targetPaths].some((path) => from.outgoingPaths.has(path));
}

export function textLinksTo(text: string, target: GraphCandidate): boolean {
  return [...target.targetPaths].some((reference) => {
    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return reference.startsWith("context-use://")
      ? new RegExp(`\\]\\(${escaped}(?:#[^)\\s]+)?\\)`, "i").test(text)
      : new RegExp(`\\[\\[${escaped}(?:[#|\\]])`, "i").test(text);
  });
}

export function candidateChanged(before: GraphCandidate | undefined, after: GraphCandidate | undefined): boolean {
  if (!before || !after || before.id !== after.id) return false;
  for (const [id, version] of after.versions) {
    const previous = before.versions.get(id);
    if (previous === undefined || version > previous) return true;
  }
  return false;
}

export function termsScore(text: string, terms?: TextTerms): number {
  if (!terms || (!(terms.all?.length) && !(terms.any?.length))) return 1;
  const comparable = (value: string): string => {
    let result = normalise(value);
    // Treat conventional thousands separators as typography: 1,000 and 1000 carry the
    // same fact. Repeat for values with more than one grouped separator.
    while (/\b\d{1,3} \d{3}\b/.test(result)) {
      result = result.replace(/\b(\d{1,3}) (\d{3})\b/g, "$1$2");
    }
    return result;
  };
  const haystack = ` ${comparable(text)} `;
  const includes = (term: string): boolean => {
    const value = comparable(term);
    if (haystack.includes(` ${value} `)) return true;
    const months = "january|february|march|april|may|june|july|august|september|october|november|december";
    const monthFirst = new RegExp(`^(${months}) (\\d{1,2})( \\d{4})?$`).exec(value);
    if (monthFirst) {
      return haystack.includes(` ${monthFirst[2]} ${monthFirst[1]}${monthFirst[3] ?? ""} `);
    }
    const dayFirst = new RegExp(`^(\\d{1,2}) (${months})( \\d{4})?$`).exec(value);
    return dayFirst
      ? haystack.includes(` ${dayFirst[2]} ${dayFirst[1]}${dayFirst[3] ?? ""} `)
      : false;
  };
  const all = terms.all ?? [];
  const any = terms.any ?? [];
  const scores: number[] = [];
  if (all.length) scores.push(all.filter(includes).length / all.length);
  if (any.length) scores.push(any.some(includes) ? 1 : 0);
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

export function dateForms(date: string): string[] {
  const [year, month, day] = date.split("-").map(Number);
  const monthName = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ][month! - 1]!;
  return [date, `${day} ${monthName}`, `${monthName} ${day}`, `${day} ${monthName} ${year}`]
    .map(normalise);
}

export function textHasDate(text: string, date: string): boolean {
  const haystack = normalise(text);
  return dateForms(date).some((form) => haystack.includes(form));
}

/** Paragraphs or timeline lines where a relationship target is actually linked. */
export function linkedContexts(from: GraphCandidate, to: GraphCandidate): string[] {
  const contexts: string[] = [];
  for (const page of from.pages) {
    for (const block of page.body.split(/\n\s*\n|\n(?=- )/)) {
      if (textLinksTo(block, to)) contexts.push(block);
    }
  }
  return contexts;
}
