import { Button } from '@repo/ui/button';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ResourceList,
  ResourceListEmpty,
  resourceCardVariants,
} from '../components/knowledge/resource-list';
import {
  KnowledgePageCardContent,
  PageRevisionBadge,
} from '../components/pages/knowledge-page-card-content';
import { Input } from '../components/ui/input';
import type { PagesClient } from './client';
import { pagesQueryKey } from './queries';

export function PagesList({
  client,
  onPage,
}: {
  client: PagesClient;
  onPage: (address: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const pages = useInfiniteQuery({
    queryKey: pagesQueryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.list(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = pages.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = items.filter((page) =>
    `${page.title} ${page.excerpt}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  return (
    <section className="grid gap-5">
      <div>
        <h1 className="font-semibold text-2xl">Your pages</h1>
        <p className="mt-2 text-muted-foreground text-sm">A place for what you want to remember.</p>
      </div>
      <Input
        aria-label="Filter loaded pages"
        placeholder="Filter loaded pages…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      {pages.isPending && <p role="status">Loading pages…</p>}
      {pages.error && (
        <div role="alert">
          <p>{pages.error.message}</p>
          <Button variant="outline" onClick={() => void pages.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {pages.isSuccess && !items.length && (
        <ResourceListEmpty title="No pages yet.">
          Create a page here, or ask your assistant to save something from this conversation.
        </ResourceListEmpty>
      )}
      {items.length > 0 && !filtered.length && (
        <ResourceListEmpty title="No loaded pages match this filter.">
          Change the filter to find a page.
        </ResourceListEmpty>
      )}
      <ResourceList className="gap-2">
        {filtered.map((page) => (
          <li key={page.address}>
            <button
              type="button"
              className={resourceCardVariants({ className: 'w-full' })}
              onClick={() => onPage(page.address)}
            >
              <KnowledgePageCardContent
                page={page}
                publicationStatus={
                  page.publication.isPublic && (
                    <PageRevisionBadge
                      revisionNumber={page.revisionNumber}
                      publishedRevisionNumber={page.publication.publishedRevisionNumber}
                    />
                  )
                }
              />
            </button>
          </li>
        ))}
      </ResourceList>
      {pages.hasNextPage && (
        <Button
          variant="outline"
          disabled={pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          {pages.isFetchingNextPage ? 'Loading…' : 'Load more pages'}
        </Button>
      )}
    </section>
  );
}
