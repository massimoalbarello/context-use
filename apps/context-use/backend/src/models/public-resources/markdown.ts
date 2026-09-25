import type { Nodes, Root, RootContent } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { isEmbeddableAssetMedia } from '#backend/models/assets/media.ts';
import { internalReferenceFromLink } from '#backend/models/knowledge-pages/markdown.ts';
import { markdownLinks } from '#backend/models/markdown/links.ts';
import { ASSET_ADDRESS_PREFIX } from '#backend/models/readable-ids/addresses.ts';

export interface PublicMarkdownTarget {
  kind: 'page' | 'entity' | 'asset' | 'record';
  readableId: string;
  publicId: string;
  mediaType: string | null;
}

type MarkdownLink = ReturnType<typeof markdownLinks>[number];

function safeExternalDestination(url: string): boolean {
  // Relative app routes and protocol-relative URLs must never cross the public boundary.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject URL control characters at this trust boundary.
  return /^(https?:\/\/|mailto:)/i.test(url) && !/[\u0000-\u0020\u007f]/.test(url);
}

function linkDestination({
  link,
  targets,
}: {
  link: MarkdownLink;
  targets: Map<string, PublicMarkdownTarget>;
}): string | null | undefined {
  const reference = internalReferenceFromLink(link);
  if (!reference) {
    return !link.embedded &&
      (link.target.url.startsWith('#') || safeExternalDestination(link.target.url))
      ? link.target.url
      : null;
  }
  const target = targets.get(`${reference.kind}:${reference.readableId}`);
  if (!target) {
    return undefined;
  }
  if (link.embedded && !isEmbeddableAssetMedia(target.mediaType ?? '')) {
    return null;
  }
  const resource = { page: 'pages', entity: 'entities', asset: 'assets', record: 'records' }[
    target.kind
  ];
  const fragment = reference.kind === 'page' && reference.fragment ? `#${reference.fragment}` : '';
  return `/public/${resource}/${encodeURIComponent(target.publicId)}${fragment}`;
}

function projectLink({ link, url }: { link: MarkdownLink; url: string | null }): RootContent[] {
  if ('children' in link.node) {
    return url
      ? [{ type: 'link', url, title: link.target.title, children: link.node.children }]
      : link.node.children;
  }
  return url ? [{ type: 'image', url, title: link.target.title, alt: link.node.alt }] : [];
}

function cleanTree({
  node,
  replacements,
}: {
  node: Nodes;
  replacements: Map<Nodes, RootContent[]>;
}): Nodes[] {
  if (node.type === 'html' || node.type === 'definition') {
    return [];
  }
  const nodes = replacements.get(node) ?? [node];
  for (const child of nodes) {
    if ('children' in child) {
      // Every replacement preserves the original node's phrasing/block category.
      child.children = child.children.flatMap((node) =>
        cleanTree({ node, replacements }),
      ) as typeof child.children;
    }
  }
  return nodes;
}

/** Produce the sole Markdown source used by both public representations. */
function projectPublicMarkdown({
  markdown,
  destination,
}: {
  markdown: string;
  destination: (link: MarkdownLink) => string | null | undefined;
}): string | null {
  const tree = fromMarkdown(markdown);
  const replacements = new Map<Nodes, RootContent[]>();
  for (const link of markdownLinks(tree)) {
    const url = destination(link);
    // An unavailable managed destination invalidates the whole public projection.
    if (url === undefined) {
      return null;
    }
    replacements.set(link.node, projectLink({ link, url }));
  }
  return toMarkdown(cleanTree({ node: tree, replacements })[0] as Root);
}

export function publicPageMarkdown({
  markdown,
  targets,
}: {
  markdown: string;
  targets: PublicMarkdownTarget[];
}): string | null {
  const byAddress = new Map(
    targets.map((target) => [`${target.kind}:${target.readableId}`, target]),
  );
  return projectPublicMarkdown({
    markdown,
    destination: (link) => linkDestination({ link, targets: byAddress }),
  });
}

export function publicRecordMarkdown({
  markdown,
  targets,
}: {
  markdown: string;
  targets: PublicMarkdownTarget[];
}): string | null {
  const byAddress = new Map(
    targets.map((target) => [`${target.kind}:${target.readableId}`, target]),
  );
  return projectPublicMarkdown({
    markdown,
    destination: (link) => {
      if (link.target.url.startsWith(ASSET_ADDRESS_PREFIX)) {
        return linkDestination({ link, targets: byAddress });
      }
      return !link.embedded &&
        (link.target.url.startsWith('#') || safeExternalDestination(link.target.url))
        ? link.target.url
        : null;
    },
  });
}
