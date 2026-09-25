import { publicDocument } from './document.tsx';
import { PublicMarkdown } from './markdown.tsx';

export function publicPageHtml({
  publicId,
  title,
  markdown,
  modifiedAt,
}: {
  publicId: string;
  title: string;
  markdown: string;
  modifiedAt: string;
}): string {
  return publicDocument({
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
