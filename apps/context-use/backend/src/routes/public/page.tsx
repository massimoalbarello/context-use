import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as markdownText } from 'mdast-util-to-string';
import { publicDocument } from './document.tsx';
import { PublicMarkdown } from './markdown.tsx';

export function publicPageHtml({
  publicId,
  canonicalUrl,
  siteName,
  title,
  markdown,
  modifiedAt,
}: {
  publicId: string;
  canonicalUrl: string;
  siteName?: string;
  title: string;
  markdown: string;
  modifiedAt: string;
}): string {
  return publicDocument({
    title,
    canonicalUrl,
    siteName,
    description:
      markdownText(fromMarkdown(markdown).children.find((node) => node.type === 'paragraph')) ||
      title,
    modifiedAt,
    markdownUrl: `/public/pages/${encodeURIComponent(publicId)}/markdown`,
    children: (
      <article>
        <PublicMarkdown markdown={markdown} />
      </article>
    ),
  });
}
