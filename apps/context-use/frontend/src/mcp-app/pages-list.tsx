import { Button } from '@repo/ui/button';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useState } from 'react';
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
        <p>
          No pages yet. Create a page here, or ask your assistant to save something from this
          conversation.
        </p>
      )}
      {items.length > 0 && !filtered.length && <p>No loaded pages match this filter.</p>}
      <ul className="grid gap-2">
        {filtered.map((page) => (
          <li key={page.address}>
            <button
              type="button"
              className="flex w-full gap-3 rounded-lg p-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onPage(page.address)}
            >
              <FileText aria-hidden="true" className="mt-1 size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block font-medium">{page.title}</span>
                <span className="mt-1 line-clamp-2 block text-muted-foreground text-sm">
                  {page.excerpt}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
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
