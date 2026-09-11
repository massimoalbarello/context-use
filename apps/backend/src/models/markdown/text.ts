import type { Nodes, Root, Text } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import stripMarkdown from 'strip-markdown';

function imageAltText(node: Nodes): Text | undefined {
  if (node.type !== 'image' && node.type !== 'imageReference') {
    return undefined;
  }
  return node.alt?.trim() ? { type: 'text', value: node.alt } : undefined;
}

const strip = stripMarkdown({
  remove: ['inlineCode', ['image', imageAltText], ['imageReference', imageAltText]],
});

/** Consumes a disposable tree, preserving visible prose, labels and block boundaries. */
export function readableMarkdownText(root: Root): string {
  return strip(root)
    .children.map((node) => mdastToString(node))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
