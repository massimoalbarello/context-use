import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { InfiniteScrollTrigger } from '../knowledge/infinite-scroll-trigger';
import { RelatedPageList } from '../knowledge/resource-list';
import { Badge } from '../ui/badge';

export function EntityPageSections<Page extends { readableId: string }>({
  query,
  renderPage,
}: {
  query: UseInfiniteQueryResult<InfiniteData<{ items: Page[]; total: number }>>;
  renderPage: (page: Page) => ReactNode;
}) {
  const pages = query.data?.pages.flatMap((batch) => batch.items) ?? [];
  const total = query.data?.pages[0]?.total;
  return (
    <section className="scroll-mt-24 pt-2" id="mentioned-by" tabIndex={-1}>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-semibold text-lg">Mentioned by</h2>
        {total !== undefined && <Badge variant="secondary">{total}</Badge>}
      </div>
      {pages.length > 0 ? (
        <RelatedPageList pages={pages} renderPage={renderPage} />
      ) : total === 0 ? (
        <p className="mt-2 text-muted-foreground text-sm">None yet.</p>
      ) : null}
      {query.isPending && <p role="status">Loading pages…</p>}
      <InfiniteScrollTrigger
        autoLoad={false}
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        error={query.error}
        loadMore={
          query.isError && !query.isFetchNextPageError ? query.refetch : query.fetchNextPage
        }
      />
    </section>
  );
}
