import { publicDocument } from './document.tsx';
import { PublicMarkdown } from './markdown.tsx';

export function publicRecordHtml({
  publicId,
  title,
  markdown,
}: {
  publicId: string;
  title: string;
  markdown: string;
}): string {
  return publicDocument({
    title,
    markdownUrl: `/public/records/${encodeURIComponent(publicId)}/markdown`,
    children: (
      <article>
        <h1>{title}</h1>
        <PublicMarkdown
          markdown={markdown}
          components={{
            h1: ({ children, node }) =>
              node?.position?.start.line === 1 && children === title ? null : <h2>{children}</h2>,
          }}
        />
      </article>
    ),
  });
}
