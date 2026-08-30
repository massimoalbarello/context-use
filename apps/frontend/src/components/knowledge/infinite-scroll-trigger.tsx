import { useEffect, useRef } from 'react';

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
        root: marker.closest('.sidebar-scroll'),
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
    <div className="infinite-scroll-trigger" ref={markerRef} aria-live="polite">
      {error ? (
        <>
          <span>Couldn’t load more.</span>
          <button type="button" onClick={() => void loadMore()}>
            Retry
          </button>
        </>
      ) : isFetchingNextPage ? (
        <span>Loading…</span>
      ) : (
        <button type="button" onClick={() => void loadMore()}>
          Load more
        </button>
      )}
    </div>
  );
}
