import { publicDocument } from './document.tsx';

export function emptyPublicHomepageHtml({
  canonicalUrl,
  siteName,
}: {
  canonicalUrl: string;
  siteName?: string;
}): string {
  return publicDocument({
    title: 'Nothing published yet',
    canonicalUrl,
    siteName,
    children: (
      <article>
        <h1>Nothing published yet</h1>
        <p>This knowledge base doesn’t have a public homepage yet. Check back soon.</p>
      </article>
    ),
  });
}
