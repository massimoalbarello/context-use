import { publicDocument } from './document.tsx';
import { PublicMarkdown } from './markdown.tsx';

export function publicRecordHtml({
  publicId,
  title,
  markdown,
  assetMedia,
}: {
  publicId: string;
  title: string;
  markdown: string;
  assetMedia?: Record<string, string>;
}): string {
  return publicDocument({
    title,
    markdownUrl: `/public/records/${encodeURIComponent(publicId)}/markdown`,
    children: (
      <article>
        <h1>{title}</h1>
        <PublicMarkdown
          markdown={markdown}
          assetMedia={assetMedia}
          components={{
            h1: ({ children, node }) =>
              node?.position?.start.line === 1 && children === title ? null : <h2>{children}</h2>,
          }}
        />
      </article>
    ),
  });
}
