import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgePageList } from '../components/pages/knowledge-page-list';
import { usePages } from '../lib/hooks/use-pages';
import { pagesQueryOptions } from '../queries/pages';

export const Route = createFileRoute('/pages')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(pagesQueryOptions),
  component: PagesLayout,
});

function PagesLayout() {
  const { data: pages = [], error } = usePages();

  return (
    <main className="knowledge-workspace">
      <KnowledgeSidebar
        title="Pages"
        count={pages.length}
        createTo="/pages/new"
        createLabel="New page"
        error={error}
      >
        <KnowledgePageList pages={pages} />
      </KnowledgeSidebar>
      <section className="workspace-detail">
        <Outlet />
      </section>
    </main>
  );
}
