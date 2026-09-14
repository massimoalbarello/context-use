import { buttonVariants } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { ArrowLeft, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { KnowledgeCollection } from '../../lib/knowledge-navigation';
import type { KnowledgeProfile } from '../../queries/profile';
import { InfiniteScrollTrigger } from './infinite-scroll-trigger';
import { KnowledgeSidebar } from './knowledge-sidebar';
import { KnowledgeWorkspace, useKnowledgeWorkspace } from './knowledge-workspace';
import { KnowledgeWorkspaceDetail } from './knowledge-workspace-detail';
import { ResourceBrowser } from './resource-browser';
import { ResourceNavigation } from './resource-navigation';
import { ResourceScrollArea } from './resource-scroll-area';

type Creation =
  | { createTo: '/entities/new' | '/pages/new' | '/assets/new'; createLabel: string }
  | { createTo?: never; createLabel?: never };
export function CollectionWorkspace({
  collection,
  title,
  count,
  profile,
  search,
  filters,
  createTo,
  createLabel,
  error,
  hasNextPage,
  isFetchingNextPage,
  loadMore,
  children,
}: Creation & {
  collection: KnowledgeCollection;
  title: string;
  count: number;
  profile: KnowledgeProfile;
  search: ReactNode;
  filters?: ReactNode;
  error?: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMore: () => Promise<unknown>;
  children: ReactNode;
}) {
  const navigate = useNavigate({ from: `/${collection}` });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isDetailRoute = pathname.replace(/\/$/, '') !== `/${collection}`;
  const { collapsed } = useKnowledgeWorkspace();
  return (
    <KnowledgeWorkspace>
      <KnowledgeSidebar profile={profile} />
      <KnowledgeWorkspaceDetail>
        {isDetailRoute ? (
          <>
            <div className={cn('shrink-0 border-b px-5 py-3', collapsed && 'pl-20')}>
              <Link
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                to={`/${collection}`}
                search={(previous) => ({
                  ...previous,
                  resource: undefined,
                  resourceId: undefined,
                  expanded: undefined,
                  view: undefined,
                })}
              >
                <ArrowLeft aria-hidden="true" />
                Back to {title.toLowerCase()}
              </Link>
            </div>
            <ResourceNavigation
              value={{
                onSelect: (selection) => {
                  void navigate({
                    to: `/${collection}`,
                    search: (previous) => ({
                      ...previous,
                      resource: selection.kind,
                      resourceId: selection.readableId,
                      expanded: true,
                      view: undefined,
                    }),
                    hash: selection.fragment,
                    resetScroll: false,
                  });
                },
              }}
            >
              <ResourceScrollArea>
                <Outlet />
              </ResourceScrollArea>
            </ResourceNavigation>
          </>
        ) : (
          <ResourceBrowser
            from={`/${collection}`}
            toolbar={
              <header className="flex shrink-0 items-center gap-2 border-b px-3 py-4.5 max-[360px]:gap-1 sm:px-5 md:gap-4 md:px-8 lg:grid lg:grid-cols-[1fr_minmax(0,28rem)_1fr]">
                <h1
                  className={cn(
                    'shrink-0 whitespace-nowrap font-semibold text-lg tracking-tight max-[360px]:text-base sm:text-2xl',
                    collapsed && 'pl-14',
                  )}
                >
                  {title}
                </h1>
                <div className="mx-auto flex min-w-0 max-w-md flex-1 lg:w-full">{search}</div>
                <div className="flex shrink-0 items-center justify-end gap-2 max-[360px]:gap-1">
                  {filters}
                  {createTo && (
                    <Link
                      className={cn(buttonVariants({ size: 'default' }), 'shrink-0')}
                      to={createTo}
                      aria-label={createLabel}
                    >
                      <Plus aria-hidden="true" />
                      <span className="hidden sm:inline">{createLabel}</span>
                      <span className="sr-only sm:hidden">{createLabel}</span>
                    </Link>
                  )}
                </div>
              </header>
            }
          >
            <section className="flex h-full min-h-0 flex-col" aria-label={title}>
              <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 md:px-8"
                data-collection-scroll
              >
                {error && count === 0 ? (
                  <p className="py-6 text-destructive text-sm" role="alert">
                    {error.message}
                  </p>
                ) : (
                  children
                )}
                <InfiniteScrollTrigger
                  hasNextPage={hasNextPage}
                  isFetchingNextPage={isFetchingNextPage}
                  error={error}
                  loadMore={loadMore}
                />
              </div>
            </section>
          </ResourceBrowser>
        )}
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
