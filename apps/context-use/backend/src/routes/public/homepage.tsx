import { PublicArticle } from './article.tsx';
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
      <PublicArticle>
        <h1>Nothing published yet</h1>
        <p>This knowledge base doesn’t have a public homepage yet. Check back soon.</p>
      </PublicArticle>
    ),
  });
}
