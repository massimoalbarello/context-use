import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { DetailHeader, DetailShell } from '../components/knowledge/detail-shell';
import { ResourceDetailHeading } from '../components/knowledge/resource-detail-heading';
import {
  KnowledgePageForm,
  type KnowledgePageFormValues,
} from '../components/pages/knowledge-page-form';
import { useCreatePage } from '../lib/hooks/use-create-page';

const EMPTY_PAGE: KnowledgePageFormValues = {
  markdown: '# A focused idea\n\n',
  temporalCoverage: null,
};

export const Route = createFileRoute('/pages/new')({
  component: NewPageRoute,
});

function NewPageRoute() {
  const navigate = useNavigate();
  const createPage = useCreatePage();

  return (
    <DetailShell className="max-w-5xl gap-5">
      <KnowledgePageForm
        initialValues={EMPTY_PAGE}
        pending={createPage.isPending}
        error={createPage.error}
        submitLabel="Create page"
        header={(intervalField) => (
          <DetailHeader className="gap-1">
            <ResourceDetailHeading actions={null} context={intervalField}>
              Knowledge page
            </ResourceDetailHeading>
            <p className="text-muted-foreground text-sm">
              The permanent address will be derived from the H1 title.
            </p>
          </DetailHeader>
        )}
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
