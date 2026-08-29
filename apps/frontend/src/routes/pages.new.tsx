import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  KnowledgePageForm,
  type KnowledgePageFormValues,
} from '../components/pages/knowledge-page-form';
import { useCreatePage } from '../lib/hooks/use-create-page';
import { useEntities } from '../lib/hooks/use-entities';
import { usePages } from '../lib/hooks/use-pages';
import { entitiesQueryOptions } from '../queries/entities';
import { pagesQueryOptions } from '../queries/pages';

const EMPTY_PAGE: KnowledgePageFormValues = {
  readableId: '',
  markdown: '# A focused idea\n\n',
};

export const Route = createFileRoute('/pages/new')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(pagesQueryOptions),
      context.queryClient.ensureQueryData(entitiesQueryOptions),
    ]);
  },
  component: NewPageRoute,
});

function NewPageRoute() {
  const navigate = useNavigate();
  const { data: pages = [] } = usePages();
  const { data: entities = [] } = useEntities();
  const createPage = useCreatePage();

  return (
    <div className="detail-shell editor-shell">
      <header className="detail-header">
        <div>
          <p className="eyebrow">New knowledge</p>
          <h1>Create a page</h1>
          <p className="detail-description">
            The permanent address will be derived from the H1 title.
          </p>
        </div>
      </header>
      <KnowledgePageForm
        initialValues={EMPTY_PAGE}
        entities={entities}
        pages={pages}
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
