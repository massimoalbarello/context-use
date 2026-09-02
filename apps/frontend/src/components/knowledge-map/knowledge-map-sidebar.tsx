import { Link } from '@tanstack/react-router';
import { Library, Search } from 'lucide-react';
import { cn } from '../../lib/class-names';
import type { KnowledgeProfile } from '../../queries/profile';
import {
  KnowledgeSidebarFooter,
  KnowledgeSidebarHeader,
} from '../knowledge/knowledge-sidebar-chrome';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace';
import { Button, buttonVariants } from '../ui/button';
import { Input } from '../ui/input';

export function KnowledgeMapSidebar({
  profile,
  totalPages,
  loadedPages,
  truncated,
  hasNextPage,
  isFetchingNextPage,
  loadMoreError,
  loadMore,
  query,
  onQueryChange,
}: {
  profile: KnowledgeProfile;
  totalPages: number;
  loadedPages: number;
  truncated: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMoreError: Error | null;
  loadMore: () => Promise<unknown>;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const { collapsed } = useKnowledgeWorkspace();

  return (
    <aside
      className={cn('flex min-h-0 flex-col overflow-hidden', collapsed && 'z-10 overflow-visible')}
      data-collapsed={collapsed}
    >
      <KnowledgeSidebarHeader />
      <div className={cn('flex min-h-0 flex-1 flex-col', collapsed && 'hidden')}>
        <div className="px-4">
          <Link
            className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-start')}
            to="/pages"
          >
            <Library aria-hidden="true" />
            Browse resources
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <label className="block" htmlFor="knowledge-map-search">
            <span className="font-medium text-sm">Find in map</span>
            <span className="relative mt-2 block">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="knowledge-map-search"
                className="h-10 pl-9"
                type="search"
                placeholder="Knowledge page, entity, or asset"
                value={query}
                onChange={(event) => onQueryChange(event.currentTarget.value)}
              />
            </span>
          </label>

          {hasNextPage && (
            <p className="mt-3 rounded-xl border bg-card p-3 text-muted-foreground text-xs leading-relaxed">
              Showing {loadedPages} of {totalPages} pages.{' '}
              {loadMoreError
                ? 'The next neighborhood could not be loaded.'
                : 'Move toward the edge of the map to reveal the next neighborhood.'}{' '}
              <Button
                className="h-auto p-0 align-baseline text-xs"
                type="button"
                variant="link"
                disabled={isFetchingNextPage}
                onClick={() => void loadMore()}
              >
                {isFetchingNextPage ? 'Loading now' : loadMoreError ? 'Retry' : 'Load it now'}
              </Button>
              .
            </p>
          )}
          {truncated && (
            <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
              This dense neighborhood was simplified to keep the map responsive.
            </p>
          )}
        </div>

        <KnowledgeSidebarFooter profile={profile} />
      </div>
    </aside>
  );
}
