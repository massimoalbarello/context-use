import { fromMarkdown } from 'mdast-util-from-markdown';
import { readableMarkdownText } from '#models/markdown/text.ts';

/** Imported evidence has no prescribed page structure or privileged title. */
export function recordSearchText(markdown: string): string {
  return readableMarkdownText(fromMarkdown(markdown));
}
