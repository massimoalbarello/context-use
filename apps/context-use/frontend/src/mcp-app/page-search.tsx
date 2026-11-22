import { Button } from '@repo/ui/button';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH } from '#backend/models/hypermedia-retrieval/model.ts';
import { KeywordFilter } from '../components/knowledge/keyword-filter';
import { ResourceList, resourceCardVariants } from '../components/knowledge/resource-list';
import { KnowledgePageCardContent } from '../components/pages/knowledge-page-card-content';
import { PublicBadge } from '../components/publications/publication-appearance';
import type { PagesClient } from './client';
import { pagesQueryKey } from './queries';

export function PageSearch({
  client,
  onPage,
}: {
  client: PagesClient;
  onPage: (address: string) => void;
}) {
  const [query, setQuery] = useState('');
  const search = useQuery({
    queryKey: [...pagesQueryKey, query],
    queryFn: () => client.search(query),
    enabled: !!query,
  });

  return (
    <section className="grid gap-4">
      <KeywordFilter
        inputId="page-search"
        placeholder="Search pages"
        maxLength={MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH}
        value={query}
        onApply={setQuery}
      />
      {query && search.isPending && <p role="status">Searching…</p>}
      {search.error && (
        <div role="alert">
          <p>{search.error.message}</p>
          <Button variant="outline" onClick={() => void search.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {search.data && (
        <>
          {search.data.pages.length ? (
            <ResourceList>
              {search.data.pages.map((page) => (
                <li key={page.address}>
                  <button
                    type="button"
                    className={resourceCardVariants({ className: 'w-full' })}
                    onClick={() => onPage(page.address)}
                  >
                    <KnowledgePageCardContent
                      page={{ ...page, excerpt: page.matchExcerpt ?? page.excerpt }}
                      publicationStatus={page.publication.isPublic && <PublicBadge />}
                    />
                  </button>
                </li>
              ))}
            </ResourceList>
          ) : (
            <p role="status">No matching pages.</p>
          )}
          {search.data.truncated && (
            <p className="text-muted-foreground text-sm">
              Showing the top matches. Refine your search to see others.
            </p>
          )}
        </>
      )}
    </section>
  );
}
