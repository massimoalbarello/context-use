import { Link } from '@tanstack/react-router';
import { House, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/class-names';
import type { KnowledgeCollection } from '../../lib/knowledge-navigation';
import type { KnowledgeProfile } from '../../queries/profile';
import { buttonVariants } from '../ui/button';
import { InfiniteScrollTrigger } from './infinite-scroll-trigger';
import { KnowledgeCollectionNavigation } from './knowledge-collection-navigation';
import { KnowledgeSidebarFooter, KnowledgeSidebarHeader } from './knowledge-sidebar-chrome';
import { useKnowledgeWorkspace } from './knowledge-workspace';

export function KnowledgeSidebar({
  collection,
  count,
  createTo,
  createLabel,
  profile,
  error,
  hasNextPage,
  isFetchingNextPage,
  loadMore,
  children,
}: {
  collection: KnowledgeCollection;
  count: number;
  createTo: '/entities/new' | '/pages/new' | '/assets/new';
  createLabel: string;
  profile: KnowledgeProfile;
  error?: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMore: () => Promise<unknown>;
  children: ReactNode;
}) {
  const { collapsed } = useKnowledgeWorkspace();
  const initialLoadFailed = Boolean(error && count === 0);

  return (
    <aside
      className={cn('flex min-h-0 flex-col overflow-hidden', collapsed && 'z-10 overflow-visible')}
      data-collapsed={collapsed}
    >
      <KnowledgeSidebarHeader />

      <div className={cn('flex min-h-0 flex-1 flex-col', collapsed && 'hidden')}>
        <div className="flex shrink-0 items-center justify-between gap-3 px-4">
          <KnowledgeCollectionNavigation
            collection={collection}
            ownerEntityReadableId={profile.selfEntity.readableId}
          />
          <div className="flex shrink-0 items-center gap-1">
            <Link
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), 'shrink-0')}
              to="/map"
              aria-label="Back to map"
              title="Back to map"
            >
              <House aria-hidden="true" />
            </Link>
            <Link
              className={cn(buttonVariants({ size: 'icon-lg' }), 'shrink-0')}
              to={createTo}
              aria-label={createLabel}
              title={createLabel}
            >
              <Plus aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2" data-sidebar-scroll>
          {initialLoadFailed ? (
            <p className="p-2 text-destructive text-sm">{error?.message}</p>
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

        <KnowledgeSidebarFooter profile={profile} />
      </div>
    </aside>
  );
}
