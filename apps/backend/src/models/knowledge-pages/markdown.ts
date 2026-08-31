import {
  type KnowledgePageLinkSet,
  MAX_KNOWLEDGE_PAGE_BYTES,
  MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH,
  MAX_KNOWLEDGE_PAGE_TITLE_LENGTH,
} from '#models/knowledge-pages/model.ts';
import { isReadableId } from '#models/readable-ids/model.ts';

const INTERNAL_REFERENCE =
  /(!?)\[([^\]\n]+)\]\(context-use:\/\/(entity|page|asset)\/([^\s/)#]+)(?:#([^\s)]+))?\)/g;
const INTERNAL_SCHEME = 'context-use://';
const HEADING_ONE = /^# (.+)$/;
const HEADING = /^ {0,3}#{1,6}\s+/;
const FENCE_START = /^ {0,3}(`{3,}|~{3,})/;
const HORIZONTAL_RULE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const WORD_BOUNDARY_SEARCH_RATIO = 0.6;

export class InvalidKnowledgePageMarkdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidKnowledgePageMarkdownError';
  }
}

function visibleMarkdownLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const visible: string[] = [];
  let fence: { character: string; length: number } | null = null;

  for (const line of lines) {
    if (fence) {
      const closing = new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`);
      if (closing.test(line)) {
        fence = null;
      }
      visible.push('');
      continue;
    }

    const opening = FENCE_START.exec(line);
    if (opening) {
      fence = { character: opening[1]![0]!, length: opening[1]!.length };
      visible.push('');
      continue;
    }

    visible.push(line.replace(/`+[^`]*`+/g, ''));
  }

  return visible;
}

function validatePageShape(markdown: string): { title: string; visibleMarkdown: string } {
  const sizeBytes = Buffer.byteLength(markdown, 'utf8');
  if (sizeBytes === 0 || sizeBytes > MAX_KNOWLEDGE_PAGE_BYTES) {
    throw new InvalidKnowledgePageMarkdownError(
      `Knowledge pages must be between 1 and ${MAX_KNOWLEDGE_PAGE_BYTES} bytes.`,
    );
  }

  const lines = visibleMarkdownLines(markdown);
  const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
  const titleMatch = firstContentLine >= 0 ? HEADING_ONE.exec(lines[firstContentLine]!) : null;
  const title = titleMatch?.[1]?.trim() ?? '';
  if (title.length === 0 || title.length > MAX_KNOWLEDGE_PAGE_TITLE_LENGTH) {
    throw new InvalidKnowledgePageMarkdownError(
      `A knowledge page must start with one H1 title of at most ${MAX_KNOWLEDGE_PAGE_TITLE_LENGTH} characters.`,
    );
  }
  if (lines.slice(firstContentLine + 1).some((line) => HEADING_ONE.test(line))) {
    throw new InvalidKnowledgePageMarkdownError(
      'A knowledge page has one H1 title; use H2 or lower headings for linkable sections.',
    );
  }
  if (!lines.slice(firstContentLine + 1).some((line) => line.trim().length > 0)) {
    throw new InvalidKnowledgePageMarkdownError('A knowledge page needs content below its title.');
  }

  return { title, visibleMarkdown: lines.join('\n') };
}

function readableText(lines: string[]): string {
  return lines
    .filter((line) => !HORIZONTAL_RULE.test(line))
    .map((line) =>
      line
        .replace(/^ {0,3}(?:#{1,6}\s+|>\s*)/, '')
        .replace(/^\s*(?:[-+*]\s+|\d+[.)]\s+)/, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[*_~]+/g, '')
        .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1')
        .trim(),
    )
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateExcerpt(text: string): string {
  if (text.length <= MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH) {
    return text;
  }
  const clipped = text.slice(0, MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH - 1).trimEnd();
  const lastSpace = clipped.lastIndexOf(' ');
  const atWordBoundary =
    lastSpace >= Math.floor(MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH * WORD_BOUNDARY_SEARCH_RATIO)
      ? clipped.slice(0, lastSpace)
      : clipped;
  return `${atWordBoundary}…`;
}

function extractExcerpt(visibleMarkdown: string): string {
  const lines = visibleMarkdown.split('\n');
  const titleIndex = lines.findIndex((line) => HEADING_ONE.test(line));
  const blocks = lines
    .slice(titleIndex + 1)
    .join('\n')
    .split(/\n\s*\n/);
  let headingFallback = '';

  for (const block of blocks) {
    const blockLines = block.split('\n').filter((line) => line.trim().length > 0);
    if (blockLines.length === 0) {
      continue;
    }
    headingFallback ||= readableText(blockLines);
    const prose = readableText(blockLines.filter((line) => !HEADING.test(line)));
    if (prose) {
      return truncateExcerpt(prose);
    }
  }

  return truncateExcerpt(headingFallback);
}

function validateInternalAddresses({
  visibleMarkdown,
  matchedRanges,
}: {
  visibleMarkdown: string;
  matchedRanges: Array<{ start: number; end: number }>;
}): void {
  let internalSchemeIndex = visibleMarkdown.indexOf(INTERNAL_SCHEME);
  while (internalSchemeIndex >= 0) {
    const isLabelledLink = matchedRanges.some(
      ({ start, end }) => internalSchemeIndex >= start && internalSchemeIndex < end,
    );
    if (!isLabelledLink) {
      throw new InvalidKnowledgePageMarkdownError(
        'Use labelled Markdown links for every internal entity mention and page reference.',
      );
    }
    internalSchemeIndex = visibleMarkdown.indexOf(INTERNAL_SCHEME, internalSchemeIndex + 1);
  }
}

type ParsedInternalReference =
  | { kind: 'entity'; readableId: string }
  | { kind: 'page'; readableId: string; fragment: string | null }
  | { kind: 'asset'; readableId: string; presentation: 'embed' | 'attachment' };

function parsedInternalReference(match: RegExpExecArray): ParsedInternalReference {
  const [, imagePrefix, label, kind, readableId, fragment] = match;
  if (!label?.trim() || !readableId || !isReadableId(readableId)) {
    throw new InvalidKnowledgePageMarkdownError('Internal links need a label and a readable ID.');
  }
  if (fragment && (!isReadableId(fragment) || kind !== 'page')) {
    throw new InvalidKnowledgePageMarkdownError('Page link fragments use lowercase heading IDs.');
  }
  if (imagePrefix && kind !== 'asset') {
    throw new InvalidKnowledgePageMarkdownError('Only assets can be embedded as images.');
  }
  if (kind === 'entity') {
    return { kind, readableId };
  }
  if (kind === 'page') {
    return { kind, readableId, fragment: fragment ?? null };
  }
  return {
    kind: 'asset',
    readableId,
    presentation: imagePrefix ? 'embed' : 'attachment',
  };
}

function extractLinks(visibleMarkdown: string): KnowledgePageLinkSet {
  const entityReadableIds = new Set<string>();
  const pageReferences = new Map<string, { readableId: string; fragment: string | null }>();
  const assetUsages = new Map<
    string,
    { readableId: string; presentation: 'embed' | 'attachment' }
  >();
  const matchedRanges: Array<{ start: number; end: number }> = [];
  INTERNAL_REFERENCE.lastIndex = 0;
  let match = INTERNAL_REFERENCE.exec(visibleMarkdown);
  while (match) {
    const reference = parsedInternalReference(match);
    if (reference.kind === 'entity') {
      entityReadableIds.add(reference.readableId);
    } else if (reference.kind === 'page') {
      pageReferences.set(`${reference.readableId}#${reference.fragment ?? ''}`, {
        readableId: reference.readableId,
        fragment: reference.fragment,
      });
    } else {
      assetUsages.set(`${reference.readableId}:${reference.presentation}`, {
        readableId: reference.readableId,
        presentation: reference.presentation,
      });
    }
    matchedRanges.push({ start: match.index, end: INTERNAL_REFERENCE.lastIndex });
    match = INTERNAL_REFERENCE.exec(visibleMarkdown);
  }

  validateInternalAddresses({ visibleMarkdown, matchedRanges });

  return {
    entityReadableIds: [...entityReadableIds],
    pageReferences: [...pageReferences.values()],
    assetUsages: [...assetUsages.values()],
  };
}

export function parseKnowledgePageMarkdown(markdown: string): {
  title: string;
  excerpt: string;
  links: KnowledgePageLinkSet;
} {
  const { title, visibleMarkdown } = validatePageShape(markdown);

  return {
    title,
    excerpt: extractExcerpt(visibleMarkdown),
    links: extractLinks(visibleMarkdown),
  };
}
