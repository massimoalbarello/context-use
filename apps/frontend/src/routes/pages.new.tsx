import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { DetailShell } from '../components/knowledge/detail-shell';
import {
  KnowledgePageForm,
  type KnowledgePageFormValues,
} from '../components/pages/knowledge-page-form';
import { useCreatePage } from '../lib/hooks/use-create-page';

const EMPTY_PAGE: KnowledgePageFormValues = {
  readableId: '',
  markdown: '# A focused idea\n\n',
};

export const Route = createFileRoute('/pages/new')({
  component: NewPageRoute,
});

function NewPageRoute() {
  const navigate = useNavigate();
  const createPage = useCreatePage();

  return (
    <DetailShell className="max-w-5xl gap-5">
      <header className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">New page</h1>
        <p className="text-muted-foreground text-sm">
          The permanent address will be derived from the H1 title.
        </p>
      </header>
      <KnowledgePageForm
        initialValues={EMPTY_PAGE}
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
    </DetailShell>
  );
}
