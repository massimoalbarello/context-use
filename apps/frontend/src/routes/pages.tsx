import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { KnowledgePageList } from '../components/pages/knowledge-page-list';
import { usePages } from '../lib/hooks/use-pages';
import { pagesQueryOptions } from '../queries/pages';

export const Route = createFileRoute('/pages')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(pagesQueryOptions),
  component: PagesLayout,
});

function PagesLayout() {
  const { profile } = Route.useRouteContext();
  const { pages, total, error, hasNextPage, isFetchingNextPage, fetchNextPage } = usePages();
  if (!profile) {
    return null;
  }

  return (
    <main className="knowledge-workspace">
      <KnowledgeSidebar
        collection="pages"
        count={total}
        createTo="/pages/new"
        createLabel="New page"
        profile={profile}
        error={error}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMore={fetchNextPage}
      >
        <KnowledgePageList pages={pages} />
      </KnowledgeSidebar>
      <KnowledgeWorkspaceDetail>
        <Outlet />
      </KnowledgeWorkspaceDetail>
    </main>
  );
}
