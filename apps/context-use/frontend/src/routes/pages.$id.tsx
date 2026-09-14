import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { KnowledgePageDetail } from '../components/pages/page-detail';
import { pageQueryOptions } from '../queries/pages';

export const Route = createFileRoute('/pages/$id')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: 'preview' | 'links' | 'revisions' } => ({
    view: ['preview', 'links', 'revisions'].includes(String(search.view))
      ? (search.view as 'preview' | 'links' | 'revisions')
      : undefined,
  }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(pageQueryOptions(params.id)),
  errorComponent: ({ error, reset }: ErrorComponentProps) => (
    <WorkspaceResourceError resource="page" error={error} retry={reset} />
  ),
  component: ResourceRoute,
});

function ResourceRoute() {
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  const { view } = Route.useSearch();
  return (
    <KnowledgePageDetail
      key={id}
      id={id}
      view={view}
      onViewChange={({ view, hash }) => {
        void navigate({ search: (previous) => ({ ...previous, view }), hash });
      }}
      onArchived={() => {
        void navigate({ to: '/pages' });
      }}
    />
  );
}
