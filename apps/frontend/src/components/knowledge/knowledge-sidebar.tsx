import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { InfiniteScrollTrigger } from './infinite-scroll-trigger';

export function KnowledgeSidebar({
  title,
  count,
  createTo,
  createLabel,
  error,
  hasNextPage,
  isFetchingNextPage,
  loadMore,
  children,
}: {
  title: string;
  count: number;
  createTo: '/pages/new' | '/entities/new';
  createLabel: string;
  error?: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMore: () => Promise<unknown>;
  children: ReactNode;
}) {
  const initialLoadFailed = Boolean(error && count === 0);

  return (
    <aside className="knowledge-sidebar">
      <header className="sidebar-header">
        <div>
          <h1>{title}</h1>
          <span className="count-badge">{count}</span>
        </div>
        <Link className="sidebar-create" to={createTo}>
          <span className="create-icon" aria-hidden="true">
            +
          </span>
          {createLabel}
        </Link>
      </header>
      <div className="sidebar-scroll">
        {initialLoadFailed ? (
          <p className="error-message sidebar-error">{error?.message}</p>
        ) : (
          <>
            {children}
            <InfiniteScrollTrigger
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              error={error}
              loadMore={loadMore}
            />
          </>
        )}
      </div>
    </aside>
  );
}
