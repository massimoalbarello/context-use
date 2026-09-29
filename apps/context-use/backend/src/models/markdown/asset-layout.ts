import type { Nodes, Paragraph, Root } from 'mdast';
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

/** Interpret only the supported presentation hints immediately following an asset embed. */
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
      const blocks: Paragraph[] = [];
      let children: Paragraph['children'] = [];
      let media = false;
      const flush = () => {
        if (children.some((node) => node.type !== 'text' || node.value.trim())) {
          blocks.push({
            ...paragraph,
            children,
            ...(media
              ? { data: { hName: 'div', hProperties: { className: ['markdown-media-row'] } } }
              : {}),
          });
        }
        children = [];
      };
      for (const node of paragraph.children) {
        let containsEmbed = false;
        visit(node, (child) => {
          containsEmbed ||= embeds.has(child);
        });
        const whitespace = node.type === 'text' && !node.value.trim();
        if (!whitespace && containsEmbed !== media) {
          flush();
          media = containsEmbed;
        }
        children.push(node);
      }
      flush();
      parent.children.splice(index, 1, ...blocks);
      return [SKIP, index + blocks.length];
    });
  };
}
