import { publicDocument } from './document.tsx';
import { PublicMarkdown } from './markdown.tsx';

export function publicPageHtml({
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
    navigation: (
      <a href={`/public/pages/${encodeURIComponent(publicId)}/markdown`}>View Markdown</a>
    ),
    children: (
      <article>
        <PublicMarkdown markdown={markdown} />
      </article>
    ),
  });
}
