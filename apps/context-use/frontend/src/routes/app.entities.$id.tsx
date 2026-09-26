import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { EntityDetail } from '../components/entities/entity-detail';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { entityQueryOptions } from '../queries/entities';

export const Route = createFileRoute('/app/entities/$id')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(entityQueryOptions(params.id)),
  errorComponent: ({ error, reset }: ErrorComponentProps) => (
    <WorkspaceResourceError resource="entity" error={error} retry={reset} />
  ),
  component: ResourceRoute,
});

function ResourceRoute() {
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <EntityDetail
      key={id}
      id={id}
      onArchived={() => {
        void navigate({ to: '/app/entities' });
      }}
    />
  );
}
