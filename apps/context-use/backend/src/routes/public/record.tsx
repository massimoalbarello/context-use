import { PublicArticle } from './article.tsx';
import { publicDocument } from './document.tsx';
import { PublicMarkdown } from './markdown.tsx';

export function publicRecordHtml({
  publicId,
  title,
  markdown,
  assetMedia,
  origin,
}: {
  publicId: string;
  title: string;
  markdown: string;
  assetMedia?: Record<string, string>;
  origin: string;
}): string {
  return publicDocument({
    title,
    markdownUrl: `/public/records/${encodeURIComponent(publicId)}/markdown`,
    children: (
      <PublicArticle>
        <h1>{title}</h1>
        <PublicMarkdown
          origin={origin}
          markdown={markdown}
          assetMedia={assetMedia}
          components={{
            h1: ({ children, node }) =>
              node?.position?.start.line === 1 && children === title ? null : <h2>{children}</h2>,
          }}
        />
      </PublicArticle>
    ),
  });
}
