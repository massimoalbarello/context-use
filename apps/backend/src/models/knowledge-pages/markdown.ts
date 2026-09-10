import type { Nodes, Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { SKIP, visit } from 'unist-util-visit';
import {
  type KnowledgePageLinkSet,
  MAX_KNOWLEDGE_PAGE_BYTES,
  MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH,
  MAX_KNOWLEDGE_PAGE_TITLE_LENGTH,
} from '#models/knowledge-pages/model.ts';
import { readableMarkdownText } from '#models/markdown/text.ts';
import { isReadableId } from '#models/readable-ids/model.ts';

const INTERNAL_ADDRESS = /^context-use:\/\/(entity|page|asset)\/([^\s/?#]+)(?:#([^\s?#]+))?$/;
const INTERNAL_SCHEME_CLAIM = /context-use:/i;
const WORD_BOUNDARY_SEARCH_RATIO = 0.6;
const LABELLED_INTERNAL_LINK_MESSAGE =
  'Use labelled Markdown links for every internal entity mention and page reference.';

type MarkdownTree = ReturnType<typeof fromMarkdown>;
type MarkdownBlock = MarkdownTree['children'][number];
type MarkdownDefinition = Extract<Nodes, { type: 'definition' }>;
type MarkdownReference = Extract<
  Nodes,
  { type: 'image' | 'imageReference' | 'link' | 'linkReference' }
>;

type ParsedInternalReference =
  | { kind: 'entity'; readableId: string }
  | { kind: 'page'; readableId: string; fragment: string | null }
  | { kind: 'asset'; readableId: string; presentation: 'embed' | 'attachment' };

export class InvalidKnowledgePageMarkdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidKnowledgePageMarkdownError';
  }
}

function normalizeReadableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function projectRoot(root: Root): string {
  return readableMarkdownText(root);
}

function projectBlock(block: MarkdownBlock): string {
  return projectRoot({ type: 'root', children: [block] });
}

function projectReferenceLabel(node: MarkdownReference): string {
  return projectRoot({
    type: 'root',
    children: [{ type: 'paragraph', children: [structuredClone(node)] }],
  });
}

function claimsInternalScheme(value: string | null | undefined): boolean {
  return Boolean(value && INTERNAL_SCHEME_CLAIM.test(value));
}

function rejectHiddenInternalAddress(value: string | null | undefined): void {
  if (claimsInternalScheme(value)) {
    throw new InvalidKnowledgePageMarkdownError(LABELLED_INTERNAL_LINK_MESSAGE);
  }
}

function validateMarkdownSize(markdown: string): void {
  const sizeBytes = Buffer.byteLength(markdown, 'utf8');
  if (sizeBytes === 0 || sizeBytes > MAX_KNOWLEDGE_PAGE_BYTES) {
    throw new InvalidKnowledgePageMarkdownError(
      `Knowledge pages must be between 1 and ${MAX_KNOWLEDGE_PAGE_BYTES} bytes.`,
    );
  }
}

function validatePageShape(tree: MarkdownTree): { body: MarkdownBlock[]; title: string } {
  const titleIndex = tree.children.findIndex(
    (node) => node.type !== 'code' && node.type !== 'definition',
  );
  const titleNode = titleIndex >= 0 ? tree.children[titleIndex] : null;
  const title = titleNode?.type === 'heading' ? projectBlock(structuredClone(titleNode)) : '';
  if (
    titleNode?.type !== 'heading' ||
    titleNode.depth !== 1 ||
    title.length === 0 ||
    title.length > MAX_KNOWLEDGE_PAGE_TITLE_LENGTH
  ) {
    throw new InvalidKnowledgePageMarkdownError(
      `A knowledge page must start with one H1 title of at most ${MAX_KNOWLEDGE_PAGE_TITLE_LENGTH} characters.`,
    );
  }

  const body = tree.children.slice(titleIndex + 1);
  if (body.some((node) => node.type === 'heading' && node.depth === 1)) {
    throw new InvalidKnowledgePageMarkdownError(
      'A knowledge page has one H1 title; use H2 or lower headings for linkable sections.',
    );
  }

  return { body, title };
}

function splitExcerpt(text: string): { excerpt: string; remainder: string } {
  if (text.length <= MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH) {
    return { excerpt: text, remainder: '' };
  }

  const clipped = text.slice(0, MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH - 1).trimEnd();
  const lastSpace = clipped.lastIndexOf(' ');
  const representedText =
    lastSpace >= Math.floor(MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH * WORD_BOUNDARY_SEARCH_RATIO)
      ? clipped.slice(0, lastSpace)
      : clipped;

  return {
    excerpt: `${representedText}…`,
    remainder: text.slice(representedText.length),
  };
}

function extractPageText(body: MarkdownBlock[]): { excerpt: string; searchableText: string } {
  const blocks = body.map((node) => ({ text: projectBlock(node), type: node.type }));
  const excerptSourceIndex = blocks.findIndex(
    ({ text, type }) => type !== 'heading' && Boolean(text),
  );
  if (excerptSourceIndex < 0) {
    throw new InvalidKnowledgePageMarkdownError(
      'A knowledge page needs readable content below its title.',
    );
  }

  const { excerpt, remainder } = splitExcerpt(blocks[excerptSourceIndex]!.text);
  blocks[excerptSourceIndex]!.text = remainder;

  return {
    excerpt,
    searchableText: normalizeReadableText(
      blocks
        .map(({ text }) => text)
        .filter(Boolean)
        .join(' '),
    ),
  };
}

function parseInternalReference({
  embedded,
  label,
  url,
}: {
  embedded: boolean;
  label: string;
  url: string;
}): ParsedInternalReference {
  const match = INTERNAL_ADDRESS.exec(url);
  if (!match) {
    throw new InvalidKnowledgePageMarkdownError(LABELLED_INTERNAL_LINK_MESSAGE);
  }

  const [, kind, readableId, fragment] = match;
  if (!label || claimsInternalScheme(label)) {
    throw new InvalidKnowledgePageMarkdownError(LABELLED_INTERNAL_LINK_MESSAGE);
  }
  if (!readableId || !isReadableId(readableId)) {
    throw new InvalidKnowledgePageMarkdownError('Internal links need a label and a readable ID.');
  }
  if (fragment && (!isReadableId(fragment) || kind !== 'page')) {
    throw new InvalidKnowledgePageMarkdownError('Page link fragments use lowercase heading IDs.');
  }
  if (embedded && kind !== 'asset') {
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
    presentation: embedded ? 'embed' : 'attachment',
  };
}

function addInternalReference({
  assetUsages,
  entityReadableIds,
  pageReferences,
  reference,
}: {
  assetUsages: Map<string, { readableId: string; presentation: 'embed' | 'attachment' }>;
  entityReadableIds: Set<string>;
  pageReferences: Map<string, { readableId: string; fragment: string | null }>;
  reference: ParsedInternalReference;
}): void {
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
}

function isMarkdownReference(node: Nodes): node is MarkdownReference {
  return (
    node.type === 'image' ||
    node.type === 'imageReference' ||
    node.type === 'link' ||
    node.type === 'linkReference'
  );
}

interface LinkExtractionState {
  assetUsages: Map<string, { readableId: string; presentation: 'embed' | 'attachment' }>;
  consumedDefinitions: Set<MarkdownDefinition>;
  definitions: Map<string, MarkdownDefinition>;
  entityReadableIds: Set<string>;
  pageReferences: Map<string, { readableId: string; fragment: string | null }>;
}

function internalReferenceFromNode({
  node,
  state,
}: {
  node: MarkdownReference;
  state: LinkExtractionState;
}): ParsedInternalReference | null {
  const definition =
    node.type === 'imageReference' || node.type === 'linkReference'
      ? state.definitions.get(node.identifier)
      : undefined;
  if (definition) {
    state.consumedDefinitions.add(definition);
  }

  const title = node.type === 'image' || node.type === 'link' ? node.title : definition?.title;
  rejectHiddenInternalAddress(title);

  const label = projectReferenceLabel(node);
  rejectHiddenInternalAddress(label);

  const url = definition?.url ?? ('url' in node ? node.url : '');
  if (!claimsInternalScheme(url)) {
    return null;
  }
  return parseInternalReference({
    embedded: node.type === 'image' || node.type === 'imageReference',
    label,
    url,
  });
}

function inspectInternalAddressNode({ node, state }: { node: Nodes; state: LinkExtractionState }) {
  if (node.type === 'code' || node.type === 'inlineCode') {
    return SKIP;
  }
  if (isMarkdownReference(node)) {
    const reference = internalReferenceFromNode({ node, state });
    if (reference) {
      addInternalReference({ ...state, reference });
    }
    return SKIP;
  }
  if (node.type === 'text' || node.type === 'html') {
    rejectHiddenInternalAddress(node.value);
  }
}

function extractLinks(tree: MarkdownTree): KnowledgePageLinkSet {
  const entityReadableIds = new Set<string>();
  const pageReferences = new Map<string, { readableId: string; fragment: string | null }>();
  const assetUsages = new Map<
    string,
    { readableId: string; presentation: 'embed' | 'attachment' }
  >();
  const definitions = new Map<string, MarkdownDefinition>();
  const definitionNodes: MarkdownDefinition[] = [];
  const consumedDefinitions = new Set<MarkdownDefinition>();
  const state: LinkExtractionState = {
    assetUsages,
    consumedDefinitions,
    definitions,
    entityReadableIds,
    pageReferences,
  };

  visit(tree, 'definition', (node) => {
    definitionNodes.push(node);
    if (!definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    }
  });

  visit(tree, (node) => inspectInternalAddressNode({ node, state }));

  for (const definition of definitionNodes) {
    rejectHiddenInternalAddress(definition.title);
    if (claimsInternalScheme(definition.url) && !consumedDefinitions.has(definition)) {
      throw new InvalidKnowledgePageMarkdownError(LABELLED_INTERNAL_LINK_MESSAGE);
    }
  }

  return {
    entityReadableIds: [...entityReadableIds],
    pageReferences: [...pageReferences.values()],
    assetUsages: [...assetUsages.values()],
  };
}

export function parseKnowledgePageMarkdown(markdown: string): {
  title: string;
  excerpt: string;
  searchableText: string;
  links: KnowledgePageLinkSet;
} {
  validateMarkdownSize(markdown);
  const tree = fromMarkdown(markdown);
  const { body, title } = validatePageShape(tree);
  const links = extractLinks(tree);
  const { excerpt, searchableText } = extractPageText(body);

  return { title, excerpt, searchableText, links };
}
