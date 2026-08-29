import { isReadableId } from '#knowledge/knowledge-address.ts';
import {
  type KnowledgePageLinkSet,
  MAX_KNOWLEDGE_PAGE_BYTES,
  MAX_KNOWLEDGE_PAGE_TITLE_LENGTH,
} from '#pages/knowledge-page.ts';

const INTERNAL_REFERENCE =
  /\[([^\]\n]+)\]\(context-use:\/\/(entity|page)\/([^\s/)#]+)(?:#([^\s)]+))?\)/g;
const INTERNAL_SCHEME = 'context-use://';
const HEADING_ONE = /^# (.+)$/;
const FENCE_START = /^ {0,3}(`{3,}|~{3,})/;

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

function extractLinks(visibleMarkdown: string): KnowledgePageLinkSet {
  const entityReadableIds = new Set<string>();
  const pageReferences = new Map<string, { readableId: string; fragment: string | null }>();
  const matchedRanges: Array<{ start: number; end: number }> = [];
  INTERNAL_REFERENCE.lastIndex = 0;
  let match = INTERNAL_REFERENCE.exec(visibleMarkdown);
  while (match) {
    const [, label, kind, readableId, fragment] = match;
    if (!label?.trim() || !readableId || !isReadableId(readableId)) {
      throw new InvalidKnowledgePageMarkdownError('Internal links need a label and a readable ID.');
    }
    if (fragment && !isReadableId(fragment)) {
      throw new InvalidKnowledgePageMarkdownError('Page link fragments use lowercase heading IDs.');
    }
    if (kind === 'entity') {
      if (fragment) {
        throw new InvalidKnowledgePageMarkdownError('Entity mentions cannot target a section.');
      }
      entityReadableIds.add(readableId);
    } else {
      const reference = { readableId, fragment: fragment ?? null };
      pageReferences.set(`${readableId}#${fragment ?? ''}`, reference);
    }
    matchedRanges.push({ start: match.index, end: INTERNAL_REFERENCE.lastIndex });
    match = INTERNAL_REFERENCE.exec(visibleMarkdown);
  }

  validateInternalAddresses({ visibleMarkdown, matchedRanges });

  return {
    entityReadableIds: [...entityReadableIds],
    pageReferences: [...pageReferences.values()],
  };
}

export function parseKnowledgePageMarkdown(markdown: string): {
  title: string;
  links: KnowledgePageLinkSet;
} {
  const { title, visibleMarkdown } = validatePageShape(markdown);

  return {
    title,
    links: extractLinks(visibleMarkdown),
  };
}
