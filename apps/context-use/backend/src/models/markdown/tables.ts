import { gfmTableFromMarkdown, gfmTableToMarkdown } from 'mdast-util-gfm-table';
import { gfmTable } from 'micromark-extension-gfm-table';
import type { Processor } from 'unified';

export const markdownTableOptions = {
  extensions: [gfmTable()],
  mdastExtensions: [gfmTableFromMarkdown()],
};

export const markdownTableSerialization = { extensions: [gfmTableToMarkdown()] };

/** Enable the same table dialect in React Markdown as in public projection. */
export function remarkTables(this: Processor) {
  const data = this.data() as {
    micromarkExtensions?: typeof markdownTableOptions.extensions;
    fromMarkdownExtensions?: typeof markdownTableOptions.mdastExtensions;
  };
  data.micromarkExtensions ??= [];
  data.fromMarkdownExtensions ??= [];
  data.micromarkExtensions.push(...markdownTableOptions.extensions);
  data.fromMarkdownExtensions.push(...markdownTableOptions.mdastExtensions);
}
