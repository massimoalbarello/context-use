import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { DetailHeader, DetailShell } from '../components/knowledge/detail-shell';
import { ResourceDetailHeading } from '../components/knowledge/resource-detail-heading';
import { KnowledgePageMarkdownInput } from '../components/pages/knowledge-link-textarea';
import { KnowledgePageForm } from '../components/pages/knowledge-page-form';
import { DuplicateResourceNameError } from '../lib/api-error';
import { useCreatePage } from '../lib/hooks/use-create-page';

export const Route = createFileRoute('/app/pages/new')({
  component: NewPageRoute,
});

function NewPageRoute() {
  const navigate = useNavigate();
  const createPage = useCreatePage();

  return (
    <DetailShell className="max-w-5xl gap-5">
      <KnowledgePageForm
        markdownInput={(input) => <KnowledgePageMarkdownInput {...input} />}
        pending={createPage.isPending}
        error={createPage.error?.message}
        duplicateTitle={createPage.error instanceof DuplicateResourceNameError}
        submitLabel="Create page"
        header={({ intervalField }) => (
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
              await navigate({ to: '/app/pages/$id', params: { id: readableId } });
            },
          })
        }
      />
    </DetailShell>
  );
}
