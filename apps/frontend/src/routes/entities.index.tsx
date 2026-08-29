import { createFileRoute, redirect } from '@tanstack/react-router';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import { entitiesQueryOptions } from '../queries/entities';

export const Route = createFileRoute('/entities/')({
  loader: async ({ context }) => {
    const entities = await context.queryClient.ensureQueryData(entitiesQueryOptions);
    const firstEntity = entities[0];
    if (firstEntity) {
      throw redirect({ to: '/entities/$id', params: { id: firstEntity.readableId } });
    }
  },
  component: EntitiesIndexRoute,
});

function EntitiesIndexRoute() {
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
