import { useEffect, useRef } from 'react';
import { Button } from '../ui/button';

export function InfiniteScrollTrigger({
  hasNextPage,
  isFetchingNextPage,
  error,
  loadMore,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  error?: Error | null;
  loadMore: () => Promise<unknown>;
}) {
  const markerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || !hasNextPage || isFetchingNextPage || error) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      {
        root: marker.closest('[data-sidebar-scroll]'),
        rootMargin: '160px 0px',
      },
    );
    observer.observe(marker);

    return () => observer.disconnect();
  }, [error, hasNextPage, isFetchingNextPage, loadMore]);

  if (!(hasNextPage || isFetchingNextPage || error)) {
    return null;
  }

  return (
    <div
      className="flex min-h-12 items-center justify-center gap-2 py-3 text-muted-foreground text-xs"
      ref={markerRef}
      aria-live="polite"
    >
      {error ? (
        <>
          <span>Couldn’t load more.</span>
          <Button variant="ghost" size="sm" type="button" onClick={() => void loadMore()}>
            Retry
          </Button>
        </>
      ) : isFetchingNextPage ? (
        <span>Loading…</span>
      ) : (
        <Button variant="ghost" size="sm" type="button" onClick={() => void loadMore()}>
          Load more
        </Button>
      )}
    </div>
  );
}
