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
    children: (
      <article>
        <h1>{siteName}</h1>
        <p>
          Browse published pages and people. Each page shows the version its owner chose to share;
          unpublished edits stay private. Open a page for its Markdown version.
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
