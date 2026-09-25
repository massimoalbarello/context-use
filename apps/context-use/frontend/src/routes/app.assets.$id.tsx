import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { AssetDetail } from '../components/assets/asset-detail';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { assetQueryOptions } from '../queries/assets';

export const Route = createFileRoute('/app/assets/$id')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(assetQueryOptions(params.id)),
  errorComponent: ({ error, reset }: ErrorComponentProps) => (
    <WorkspaceResourceError resource="asset" error={error} retry={reset} />
  ),
  component: ResourceRoute,
});

function ResourceRoute() {
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <AssetDetail
      key={id}
      id={id}
      onArchived={() => {
        void navigate({ to: '/app/assets' });
      }}
    />
  );
}
