import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  KnowledgePageForm,
  type KnowledgePageFormValues,
} from '../components/pages/knowledge-page-form';
import { KnowledgePageList } from '../components/pages/knowledge-page-list';
import { useCreatePage } from '../lib/hooks/use-create-page';
import { useEntities } from '../lib/hooks/use-entities';
import { usePages } from '../lib/hooks/use-pages';
import { entitiesQueryOptions } from '../queries/entities';
import { pagesQueryOptions } from '../queries/pages';

const EMPTY_PAGE: KnowledgePageFormValues = {
  readableId: '',
  markdown: '# A focused idea\n\n',
};

export const Route = createFileRoute('/pages/')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(pagesQueryOptions),
      context.queryClient.ensureQueryData(entitiesQueryOptions),
    ]);
  },
  component: PagesRoute,
});

function PagesRoute() {
  const navigate = useNavigate();
  const { data: pages = [], error: pagesError } = usePages();
  const { data: entities = [], error: entitiesError } = useEntities();
  const createPage = useCreatePage();
  const error = pagesError ?? entitiesError;

  const create = (values: KnowledgePageFormValues) => {
    createPage.mutate(values, {
      onSuccess: async () => {
        await navigate({
          to: '/pages/$id',
          params: { id: values.readableId },
        });
      },
    });
  };

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Hypermedia</p>
          <h1>Knowledge pages</h1>
          <p>Small, coherent accounts connected through explicit, readable links.</p>
        </div>
      </header>

      <section className="split-layout split-layout-wide">
        <div>
          <div className="section-heading">
            <h2>Current knowledge</h2>
            <span>{pages.length}</span>
          </div>
          {error ? (
            <p className="error-message">{error.message}</p>
          ) : (
            <KnowledgePageList pages={pages} />
          )}
        </div>
        <div>
          <div className="section-heading">
            <h2>Create a page</h2>
          </div>
          <KnowledgePageForm
            initialValues={EMPTY_PAGE}
            entities={entities}
            pages={pages}
            pending={createPage.isPending}
            error={createPage.error}
            submitLabel="Create page"
            onSubmit={create}
          />
        </div>
      </section>
    </main>
  );
}
