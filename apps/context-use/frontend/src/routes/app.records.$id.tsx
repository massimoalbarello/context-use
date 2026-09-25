import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { RecordDetail } from '../components/records/record-detail';
import { recordQueryOptions } from '../queries/records';

export const Route = createFileRoute('/app/records/$id')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: 'preview' | 'metadata' | 'links' } => ({
    view: ['preview', 'metadata', 'links'].includes(String(search.view))
      ? (search.view as 'preview' | 'metadata' | 'links')
      : undefined,
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(recordQueryOptions(params.id)),
  errorComponent: ({ error, reset }: ErrorComponentProps) => (
    <WorkspaceResourceError resource="record" error={error} retry={reset} />
  ),
  component: ResourceRoute,
});

function ResourceRoute() {
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  const { view } = Route.useSearch();
  return (
    <RecordDetail
      key={id}
      id={id}
      view={view}
      onViewChange={({ view, hash }) => {
        void navigate({ search: (previous) => ({ ...previous, view }), hash });
      }}
    />
  );
}
