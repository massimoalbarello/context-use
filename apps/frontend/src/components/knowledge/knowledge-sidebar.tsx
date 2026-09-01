import { Link } from '@tanstack/react-router';
import { Menu, Plus, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/class-names';
import type { KnowledgeCollection } from '../../lib/knowledge-navigation';
import type { KnowledgeProfile } from '../../queries/profile';
import { SignOutButton } from '../auth/sign-out-button';
import { EntityAvatar } from '../entities/entity-link';
import { Button, buttonVariants } from '../ui/button';
import { InfiniteScrollTrigger } from './infinite-scroll-trigger';
import { KnowledgeCollectionNavigation } from './knowledge-collection-navigation';
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
  const { collapsed, toggleSidebar } = useKnowledgeWorkspace();
  const initialLoadFailed = Boolean(error && count === 0);

  return (
    <aside
      className={cn('flex min-h-0 flex-col overflow-hidden', collapsed && 'z-10 overflow-visible')}
      data-collapsed={collapsed}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-between gap-3 p-3',
          collapsed && 'absolute top-6 left-6 items-center justify-center p-0 md:top-7 md:left-7',
        )}
      >
        <Link
          className={cn('flex min-w-0 items-center', collapsed && 'hidden')}
          to="/pages"
          aria-label="Context Use"
        >
          <span className="grid min-w-0 leading-tight">
            <strong className="truncate font-semibold text-sm">Context Use</strong>
            <small className="truncate text-muted-foreground text-xs">Private workspace</small>
          </span>
        </Link>
        <Button
          className={cn(
            'size-10 shrink-0 rounded-xl bg-transparent text-muted-foreground [&_svg]:size-5',
            collapsed && 'size-11 bg-muted shadow-lg hover:bg-accent hover:text-accent-foreground',
          )}
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={collapsed ? 'Open sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          onClick={toggleSidebar}
        >
          <Menu aria-hidden="true" />
        </Button>
      </div>

      <div className={cn('flex min-h-0 flex-1 flex-col', collapsed && 'hidden')}>
        <div className="flex shrink-0 items-center justify-between gap-3 px-4">
          <KnowledgeCollectionNavigation
            collection={collection}
            ownerEntityId={profile.selfEntity.id}
          />
          <Link
            className={cn(buttonVariants({ size: 'icon-lg' }), 'shrink-0')}
            to={createTo}
            aria-label={createLabel}
            title={createLabel}
          >
            <Plus aria-hidden="true" />
          </Link>
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

        <footer className="flex shrink-0 items-center gap-2 px-3 py-3">
          <Link
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 hover:bg-card"
            to="/entities/$id"
            params={{ id: profile.selfEntity.readableId }}
          >
            <EntityAvatar entity={profile.selfEntity} className="size-8" />
            <span className="grid min-w-0 leading-tight">
              <strong className="truncate font-medium text-xs">{profile.selfEntity.name}</strong>
              <small className="truncate text-[0.68rem] text-muted-foreground">Your entity</small>
            </span>
          </Link>
          <Link
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            to="/settings"
            aria-label="Settings"
            title="Settings"
          >
            <Settings aria-hidden="true" />
          </Link>
          <SignOutButton />
        </footer>
      </div>
    </aside>
  );
}
