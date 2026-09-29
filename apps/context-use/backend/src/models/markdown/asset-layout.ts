import type { Nodes, Paragraph, PhrasingContent, Root } from 'mdast';
import { SKIP, visit } from 'unist-util-visit';
import { markdownLinks } from './links.ts';

const LAYOUT_CLASSES: Record<string, string> = {
  'layout=half': 'asset-half',
  'layout=third': 'asset-third',
  'size=small': 'asset-small',
  'size=medium': 'asset-medium',
  'size=large': 'asset-large',
  'align=left': 'asset-left',
  'align=center': 'asset-center',
  'align=right': 'asset-right',
};

function consumeLayoutHint(next: Nodes | undefined): string[] {
  if (next?.type !== 'text') {
    return [];
  }
  const annotation = /^[ \t]*(?:\n[ \t]*)?\{([^{}\n]+)\}/.exec(next.value);
  const tokens = annotation?.[1]?.trim().split(/\s+/) ?? [];
  if (
    !annotation ||
    !tokens.length ||
    !tokens.every((token) => Object.hasOwn(LAYOUT_CLASSES, token))
  ) {
    return [];
  }
  next.value = next.value.slice(annotation[0].length);
  return tokens.map((token) => LAYOUT_CLASSES[token]!);
}

function layoutEmbeds({
  paragraph,
  embeds,
}: {
  paragraph: Paragraph;
  embeds: Set<Nodes>;
}): boolean {
  const linkedEmbeds = new Set<Nodes>();
  visit(paragraph, (node) => {
    if (node.type === 'link' || node.type === 'linkReference') {
      visit(node, (child) => {
        if (embeds.has(child)) {
          linkedEmbeds.add(child);
        }
      });
    }
  });
  let hasEmbed = false;
  // biome-ignore lint/complexity/useMaxParams: mdast visitors receive the node, index, and parent.
  visit(paragraph, (node, index, parent) => {
    if (!embeds.has(node)) {
      return;
    }
    hasEmbed = true;
    const classes = ['markdown-asset', ...consumeLayoutHint(parent?.children[(index ?? -1) + 1])];
    node.data = {
      ...node.data,
      hProperties: {
        ...node.data?.hProperties,
        className: classes,
        ...(linkedEmbeds.has(node) ? { 'data-asset-linked': true } : {}),
      },
    };
  });
  return hasEmbed;
}

function hasVisibleProse(node: PhrasingContent): boolean {
  if (node.type === 'text') {
    return Boolean(node.value.trim());
  }
  return node.type !== 'html' && node.type !== 'break';
}

function separateEmbedContent({
  children,
  embeds,
}: {
  children: PhrasingContent[];
  embeds: Set<Nodes>;
}): { prose: PhrasingContent[]; media: PhrasingContent[]; hasProse: boolean } {
  const prose: PhrasingContent[] = [];
  const media: PhrasingContent[] = [];
  let hasProse = false;
  for (const node of children) {
    if (embeds.has(node) && 'alt' in node) {
      prose.push({ type: 'text', value: node.alt ?? '' });
      media.push(node);
    } else if ('children' in node) {
      const separated = separateEmbedContent({ children: node.children, embeds });
      if (separated.prose.length) {
        prose.push({ ...node, children: separated.prose });
      }
      if (separated.media.length) {
        media.push({ ...node, children: separated.media });
      }
      hasProse ||= separated.hasProse;
    } else {
      prose.push(node);
      hasProse ||= hasVisibleProse(node);
    }
  }
  return { prose, media, hasProse };
}

/** Lay out local asset embeds, keeping inline labels in their surrounding prose. */
export function remarkAssetLayout() {
  return (tree: Root) => {
    const embeds = new Set<Nodes>(
      markdownLinks(tree)
        .filter(
          ({ embedded, target }) =>
            embedded &&
            /^(?:context-use:\/\/asset\/|\/public\/assets\/)[a-zA-Z0-9_-]+$/.test(target.url),
        )
        .map(({ node }) => node),
    );
    // biome-ignore lint/complexity/useMaxParams: mdast visitors receive the node, index, and parent.
    visit(tree, 'paragraph', (paragraph, index, parent) => {
      if (!layoutEmbeds({ paragraph, embeds }) || !parent || index === undefined) {
        return;
      }
      const { prose, media, hasProse } = separateEmbedContent({
        children: paragraph.children,
        embeds,
      });
      const blocks: Paragraph[] = [
        ...(hasProse ? [{ ...paragraph, children: prose }] : []),
        {
          ...paragraph,
          children: hasProse ? media : paragraph.children,
          data: { hName: 'div', hProperties: { className: ['markdown-media-row'] } },
        },
      ];
      parent.children.splice(index, 1, ...blocks);
      return [SKIP, index + blocks.length];
    });
  };
}
