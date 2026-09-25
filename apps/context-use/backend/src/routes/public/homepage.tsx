import { publicDocument } from './document.tsx';

export function emptyPublicHomepageHtml(): string {
  return publicDocument({
    title: 'Nothing published yet',
    navigation: <a href="/app">Owner login</a>,
    children: (
      <article>
        <h1>Nothing published yet</h1>
        <p>This knowledge base doesn’t have a public homepage yet. Check back soon.</p>
      </article>
    ),
  });
}
