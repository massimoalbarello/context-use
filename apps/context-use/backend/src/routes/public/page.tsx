import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as markdownText } from 'mdast-util-to-string';
import type { Components } from 'react-markdown';
import { publicDocument } from './document.tsx';
import { PublicMarkdown } from './markdown.tsx';

export function publicPageHtml({
  publicId,
  canonicalUrl,
  siteName,
  title,
  markdown,
  modifiedAt,
  linkTarget,
  components,
}: {
  publicId?: string;
  canonicalUrl?: string;
  siteName?: string;
  title: string;
  markdown: string;
  modifiedAt: string;
  linkTarget?: '_blank';
  components?: Components;
}): string {
  return publicDocument({
    title,
    canonicalUrl,
    siteName,
    description:
      markdownText(fromMarkdown(markdown).children.find((node) => node.type === 'paragraph')) ||
      title,
    modifiedAt,
    linkTarget,
    markdownUrl: publicId ? `/public/pages/${encodeURIComponent(publicId)}/markdown` : undefined,
    children: (
      <article>
        <PublicMarkdown markdown={markdown} components={components} />
      </article>
    ),
  });
}
