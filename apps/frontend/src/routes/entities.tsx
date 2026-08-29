import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { EntityList } from '../components/entities/entity-list';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { useEntities } from '../lib/hooks/use-entities';
import { entitiesQueryOptions } from '../queries/entities';

export const Route = createFileRoute('/entities')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(entitiesQueryOptions),
  component: EntitiesLayout,
});

function EntitiesLayout() {
  const { data: entities = [], error } = useEntities();

  return (
    <main className="knowledge-workspace">
      <KnowledgeSidebar
        title="Entities"
        count={entities.length}
        createTo="/entities/new"
        createLabel="New entity"
        error={error}
      >
        <EntityList entities={entities} />
      </KnowledgeSidebar>
      <section className="workspace-detail">
        <Outlet />
      </section>
    </main>
  );
}
