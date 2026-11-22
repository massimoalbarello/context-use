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
import { RecordCardContent } from '../components/records/record-link';
import { isEmbeddableAsset } from '../lib/asset-presentation';
import { type PagesClient, pickerInput, type SearchHit, type SearchInput } from './client';
import { searchQueryKey } from './queries';
import { useContentSize, WidgetLoading } from './widget-loading';

export function PageSearch({
  client,
  onPage,
  query,
  setQuery,
  filters,
}: {
  client: PagesClient;
  query: string;
  setQuery: (query: string) => void;
  filters?: SearchInput;
  onPage: (address: string) => void;
}) {
  const input = pickerInput({ ...filters, query });
  const search = useQuery({
    queryKey: [...searchQueryKey, input],
    queryFn: () => client.search(input),
    enabled: !!query,
    staleTime: 30_000,
  });

  useContentSize({ client, ready: !query || !search.isPending });

  return (
    <section className="grid gap-4">
      <KeywordFilter
        inputId="page-search"
        placeholder={
          filters?.resourceTypes?.length === 1 && filters.resourceTypes[0] === 'knowledge_page'
            ? 'Search pages'
            : 'Search Context Use'
        }
        maxLength={MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH}
        value={query}
        onApply={setQuery}
      />
      {query && search.isPending && <WidgetLoading label="Searching" />}
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
              {search.data.results.map((item) => (
                <SearchResult key={item.address} item={item} onOpen={onPage} />
              ))}
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

function SearchResult({ item, onOpen }: { item: SearchHit; onOpen: (address: string) => void }) {
  if (item.resourceType === 'record') {
    return (
      <li className="flex items-center gap-3 px-3 py-2">
        <RecordCardContent record={item} />
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        className={resourceCardVariants({ className: 'w-full' })}
        onClick={() => onOpen(item.address)}
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
  );
}
