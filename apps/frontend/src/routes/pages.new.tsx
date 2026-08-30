import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  KnowledgePageForm,
  type KnowledgePageFormValues,
} from '../components/pages/knowledge-page-form';
import { useCreatePage } from '../lib/hooks/use-create-page';
import { useEntities } from '../lib/hooks/use-entities';
import { entitiesQueryOptions } from '../queries/entities';

const EMPTY_PAGE: KnowledgePageFormValues = {
  readableId: '',
  markdown: '# A focused idea\n\n',
};

export const Route = createFileRoute('/pages/new')({
  loader: ({ context }) => context.queryClient.ensureQueryData(entitiesQueryOptions),
  component: NewPageRoute,
});

function NewPageRoute() {
  const navigate = useNavigate();
  const { data: entities = [] } = useEntities();
  const createPage = useCreatePage();

  return (
    <div className="detail-shell editor-shell">
      <header className="editor-header">
        <h1>New page</h1>
        <p>The permanent address will be derived from the H1 title.</p>
      </header>
      <KnowledgePageForm
        initialValues={EMPTY_PAGE}
        entities={entities}
        pending={createPage.isPending}
        error={createPage.error}
        submitLabel="Create page"
        onSubmit={(values) =>
          createPage.mutate(values, {
            onSuccess: async ({ readableId }) => {
              await navigate({ to: '/pages/$id', params: { id: readableId } });
            },
          })
        }
      />
    </div>
  );
}
