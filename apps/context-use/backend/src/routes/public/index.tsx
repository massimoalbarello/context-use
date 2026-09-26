import { DEFAULT_PUBLIC_SITE_NAME } from '#backend/lib/runtime-config.ts';
import type { PublicResourcesServiceContract } from '#backend/services/public-resources/service.ts';
import { publicDocument } from './document.tsx';
import { publicResourcePath } from './markdown.ts';

type PublicIndex = Awaited<ReturnType<PublicResourcesServiceContract['index']>>;

export function publicIndexHtml({
  entries,
  page,
  nextPage,
  origin,
  siteName = DEFAULT_PUBLIC_SITE_NAME,
}: {
  entries: PublicIndex['entries'];
  page: number;
  nextPage: number | null;
  origin: string;
  siteName?: string;
}) {
  const path = page === 1 ? '/public/directory' : `/public/directory?page=${page}`;
  return publicDocument({
    title: siteName,
    siteName,
    description: 'Explore the pages and people shared publicly from this knowledge base.',
    canonicalUrl: new URL(path, origin).href,
    markdownUrl: `/llms.txt?page=${page}`,
    children: (
      <article>
        <h1>{siteName}</h1>
        <p>
          Ideas, notes, and people shared from this knowledge base. Follow a page to explore what
          connects them.
        </p>
        <p>
          Use this directory to read published notes, learn about the people and organizations they
          mention, and follow references between them. Everything listed here is available without
          an account. Each page shows the revision its owner chose to publish; later private edits
          stay private until the owner publishes them.
        </p>
        <p>
          Each article includes a Markdown view for reading in other tools. The AI-readable site
          index lists the same public content. To manage your own knowledge base, use Owner login
          and sign in with your passkey.
        </p>
        {entries.length ? (
          (['page', 'entity'] as const).map((kind) => {
            const group = entries.filter((entry) => entry.kind === kind);
            return group.length ? (
              <section key={kind} aria-labelledby={`index-${kind}`}>
                <h2 id={`index-${kind}`}>{kind === 'page' ? 'Pages' : 'Entities'}</h2>
                <ul>
                  {group.map((entry) => (
                    <li key={entry.publicId}>
                      <a href={publicResourcePath(entry)}>{entry.title}</a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null;
          })
        ) : (
          <p>No public content is listed here yet.</p>
        )}
        {page > 1 || nextPage ? (
          <nav className="pagination" aria-label="Index pages">
            {page > 1 ? (
              <a
                rel="prev"
                href={page === 2 ? '/public/directory' : `/public/directory?page=${page - 1}`}
              >
                Previous pages
              </a>
            ) : null}
            {nextPage ? (
              <a rel="next" href={`/public/directory?page=${nextPage}`}>
                More public content
              </a>
            ) : null}
          </nav>
        ) : null}
      </article>
    ),
  });
}
