import { createFileRoute, redirect } from '@tanstack/react-router';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import { entitiesQueryOptions } from '../queries/entities';

export const Route = createFileRoute('/entities/')({
  loaderDeps: ({ search }) => ({ query: search.q, entityType: search.entityType }),
  loader: async ({ context, deps }) => {
    const entities = await context.queryClient.ensureInfiniteQueryData(entitiesQueryOptions(deps));
    const firstEntity = entities.pages[0]?.items[0];
    if (firstEntity) {
      throw redirect({
        to: '/entities/$id',
        params: { id: firstEntity.readableId },
        search: { q: deps.query, entityType: deps.entityType },
      });
    }
  },
  component: EntitiesIndexRoute,
});

function EntitiesIndexRoute() {
  const { q, entityType } = Route.useSearch();
  if (q || entityType) {
    return (
      <WorkspaceEmpty
        eyebrow="Coordinates"
        title="No entities match this search"
        description="Clear or change the entity filters in the sidebar."
        createTo="/entities/new"
        createLabel="Create an entity"
      />
    );
  }
  return (
    <WorkspaceEmpty
      eyebrow="Coordinates"
      title="No entities yet"
      description="Create an entity so pages have a stable identity to mention."
      createTo="/entities/new"
      createLabel="Create an entity"
    />
  );
}
