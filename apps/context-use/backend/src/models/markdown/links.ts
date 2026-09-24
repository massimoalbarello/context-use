import type { Definition, Image, ImageReference, Link, LinkReference, Root } from 'mdast';
import { visit } from 'unist-util-visit';

// Resolve only links that occur in Markdown, including reference-style links and images.
export function markdownLinks(tree: Root) {
  const definitions = new Map<string, Definition>();
  visit(tree, 'definition', (node) => {
    if (!definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    }
  });
  const links: Array<{
    node: Link | Image | LinkReference | ImageReference;
    target: Link | Image | Definition;
    embedded: boolean;
  }> = [];
  visit(tree, (node) => {
    if (node.type === 'link' || node.type === 'image') {
      links.push({ node, target: node, embedded: node.type === 'image' });
    } else if (node.type === 'linkReference' || node.type === 'imageReference') {
      const target = definitions.get(node.identifier);
      if (target) {
        links.push({ node, target, embedded: node.type === 'imageReference' });
      }
    }
  });
  return links;
}
