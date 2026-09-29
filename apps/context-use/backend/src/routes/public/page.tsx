import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as markdownText } from 'mdast-util-to-string';
import type { Components } from 'react-markdown';
import { remarkAssetLayout } from '#backend/models/markdown/asset-layout.ts';
import { publicDocument } from './document.tsx';
import { PublicMarkdown } from './markdown.tsx';

export function publicPageHtml({
  publicId,
  canonicalUrl,
  siteName,
  title,
  markdown,
  assetMedia,
  modifiedAt,
  linkTarget,
  components,
}: {
  publicId?: string;
  canonicalUrl?: string;
  siteName?: string;
  title: string;
  markdown: string;
  assetMedia?: Record<string, string>;
  modifiedAt: string;
  linkTarget?: '_blank';
  components?: Components;
}): string {
  const tree = fromMarkdown(markdown);
  remarkAssetLayout()(tree);
  return publicDocument({
    title,
    canonicalUrl,
    siteName,
    description: markdownText(tree.children.find((node) => node.type === 'paragraph')) || title,
    modifiedAt,
    linkTarget,
    markdownUrl: publicId ? `/public/pages/${encodeURIComponent(publicId)}/markdown` : undefined,
    children: (
      <article>
        <PublicMarkdown markdown={markdown} assetMedia={assetMedia} components={components} />
      </article>
    ),
  });
}
