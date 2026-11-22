import { Button } from '@repo/ui/button';
import { useQuery } from '@tanstack/react-query';
import { File, Image as ImageIcon } from 'lucide-react';
import { MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH } from '#backend/models/hypermedia-retrieval/model.ts';
import { AssetCardContent } from '../components/assets/asset-link';
import { EntityCardContent } from '../components/entities/entity-link';
import { KeywordFilter } from '../components/knowledge/keyword-filter';
import { ResourceList, resourceCardVariants } from '../components/knowledge/resource-list';
import { KnowledgePageCardContent } from '../components/pages/knowledge-page-link';
import { PublicBadge } from '../components/publications/publication-appearance';
import { isEmbeddableAsset } from '../lib/asset-presentation';
import type { PagesClient, WidgetSearch } from './client';
import { searchQueryKey } from './queries';

export function PageSearch({
  client,
  onPage,
  query,
  setQuery,
  resourceType,
}: {
  client: PagesClient;
  query: string;
  setQuery: (query: string) => void;
  resourceType?: WidgetSearch['resourceType'];
  onPage: (address: string) => void;
}) {
  const search = useQuery({
    queryKey: [...searchQueryKey, query, resourceType],
    queryFn: () => client.search({ query, resourceType }),
    enabled: !!query,
    staleTime: 30_000,
  });

  return (
    <section className="grid gap-4">
      <KeywordFilter
        inputId="page-search"
        placeholder={
          resourceType === 'knowledge_page'
            ? 'Search pages'
            : resourceType === 'entity'
              ? 'Search entities'
              : resourceType === 'asset'
                ? 'Search assets'
                : 'Search pages, entities, and assets'
        }
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
      {query && search.data && (
        <>
          {search.data.results.length ? (
            <ResourceList>
              {search.data.results.map(
                (item) =>
                  item.resourceType !== 'record' && (
                    <li key={item.address}>
                      <button
                        type="button"
                        className={resourceCardVariants({ className: 'w-full' })}
                        onClick={() => onPage(item.address)}
                      >
                        {item.resourceType === 'knowledge_page' ? (
                          <KnowledgePageCardContent
                            page={{ ...item, excerpt: item.matchExcerpt ?? item.excerpt }}
                            publicationStatus={item.publication.isPublic && <PublicBadge />}
                          />
                        ) : item.resourceType === 'entity' ? (
                          <EntityCardContent entity={item} />
                        ) : (
                          <AssetCardContent
                            asset={item}
                            thumbnail={
                              isEmbeddableAsset(item) ? (
                                <ImageIcon aria-hidden="true" />
                              ) : (
                                <File aria-hidden="true" />
                              )
                            }
                          />
                        )}
                      </button>
                    </li>
                  ),
              )}
            </ResourceList>
          ) : (
            <p role="status">No matches.</p>
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
