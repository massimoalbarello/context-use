import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { EntityList } from '../components/entities/entity-list';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { useEntities } from '../lib/hooks/use-entities';
import { entitiesQueryOptions } from '../queries/entities';

export const Route = createFileRoute('/entities')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(entitiesQueryOptions),
  component: EntitiesLayout,
});

function EntitiesLayout() {
  const { entities, total, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useEntities();

  return (
    <main className="knowledge-workspace">
      <KnowledgeSidebar
        title="Entities"
        count={total}
        createTo="/entities/new"
        createLabel="New entity"
        error={error}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMore={fetchNextPage}
      >
        <EntityList entities={entities} />
      </KnowledgeSidebar>
      <KnowledgeWorkspaceDetail>
        <Outlet />
      </KnowledgeWorkspaceDetail>
    </main>
  );
}
