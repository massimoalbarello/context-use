import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { useState } from 'react';
import { EntityLink } from '../components/entities/entity-link';
import { ResourceDetailHeading } from '../components/knowledge/resource-detail-heading';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { KnowledgePageForm } from '../components/pages/knowledge-page-form';
import { KnowledgePageLink } from '../components/pages/knowledge-page-link';
import { KnowledgePageMarkdown } from '../components/pages/knowledge-page-markdown';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { usePage } from '../lib/hooks/use-page';
import { useUpdatePage } from '../lib/hooks/use-update-page';
import { type KnowledgePage, pageQueryOptions } from '../queries/pages';

type PageView = 'preview' | 'links' | 'revisions';

const PAGE_EDIT_FORM_ID = 'knowledge-page-edit-form';

function isPageView(value: unknown): value is PageView {
  return value === 'preview' || value === 'links' || value === 'revisions';
}

export const Route = createFileRoute('/pages/$id')({
  validateSearch: (search: Record<string, unknown>): { view?: PageView } => ({
    view: isPageView(search.view) ? search.view : undefined,
  }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(pageQueryOptions(params.id)),
  errorComponent: KnowledgePageRouteError,
  component: KnowledgePageRoute,
});

function KnowledgePageRouteError({ error, reset }: ErrorComponentProps) {
  return <WorkspaceResourceError resource="page" error={error} retry={reset} />;
}

function PageLinkList({ label, links }: { label: string; links: KnowledgePage['references'] }) {
  return (
    <section className="link-section">
      <div className="section-heading">
        <h2>{label}</h2>
        <Badge variant="secondary">{links.length}</Badge>
      </div>
      {links.length > 0 ? (
        <ul className="object-card-list">
          {links.map(({ page, fragment }) => (
            <li key={`${page.id}#${fragment ?? ''}`}>
              <KnowledgePageLink page={page} presentation="card" fragment={fragment ?? undefined} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="connection-empty">None yet.</p>
      )}
    </section>
  );
}

function PageLinksView({ page }: { page: KnowledgePage }) {
  return (
    <div className="page-connections">
      <section className="link-section">
        <div className="section-heading">
          <h2>Mentions</h2>
          <Badge variant="secondary">{page.mentions.length}</Badge>
        </div>
        {page.mentions.length > 0 ? (
          <ul className="object-card-list">
            {page.mentions.map((entity) => (
              <li key={entity.id}>
                <EntityLink entity={entity} presentation="card" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="connection-empty">None yet.</p>
        )}
      </section>
      <PageLinkList label="References" links={page.references} />
      <PageLinkList label="Referenced by" links={page.backlinks} />
    </div>
  );
}

function PageRevisionsView({ page }: { page: KnowledgePage }) {
  return (
    <section className="page-revisions">
      <div className="section-heading">
        <h2>Revisions</h2>
        <Badge variant="secondary">{page.revisions.length}</Badge>
      </div>
      <ol className="revision-list">
        {page.revisions.map((revision) => (
          <li key={revision.revisionNumber}>
            <div>
              <strong>Revision {revision.revisionNumber}</strong>
              {revision.revisionNumber === page.revisionNumber && (
                <Badge variant="secondary">Current</Badge>
              )}
            </div>
            <p>{revision.title}</p>
            <time dateTime={revision.createdAt.toISOString()}>
              {revision.createdAt.toLocaleString()}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function KnowledgePageRoute() {
  const { id } = Route.useParams();
  const { view = 'preview' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [editing, setEditing] = useState(false);
  const { data: page, error, refetch } = usePage(id);
  const updatePage = useUpdatePage();

  if (error) {
    return (
      <WorkspaceResourceError
        resource="page"
        error={error}
        retry={() => {
          void refetch();
        }}
      />
    );
  }
  if (!page) {
    return null;
  }

  return (
    <div className="detail-shell page-detail" data-editing={editing}>
      <header className="detail-header">
        <ResourceDetailHeading
          actions={
            editing ? (
              <>
                <Button
                  variant="outline"
                  size="lg"
                  type="button"
                  onClick={() => {
                    updatePage.reset();
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="lg"
                  type="submit"
                  form={PAGE_EDIT_FORM_ID}
                  disabled={updatePage.isPending}
                >
                  {updatePage.isPending ? 'Saving…' : 'Save page'}
                </Button>
              </>
            ) : (
              <Button
                size="lg"
                type="button"
                onClick={() => {
                  updatePage.reset();
                  setEditing(true);
                }}
              >
                Edit page
              </Button>
            )
          }
        >
          Knowledge page
        </ResourceDetailHeading>
      </header>

      {editing ? (
        <KnowledgePageForm
          key={page.revisionNumber}
          initialValues={{ readableId: page.readableId, markdown: page.markdown }}
          readableIdLocked
          formId={PAGE_EDIT_FORM_ID}
          pending={updatePage.isPending}
          error={updatePage.error}
          onSubmit={({ markdown }) =>
            updatePage.mutate(
              {
                readableId: page.readableId,
                body: { expectedRevisionNumber: page.revisionNumber, markdown },
              },
              { onSuccess: () => setEditing(false) },
            )
          }
        />
      ) : (
        <Tabs
          className="detail-view"
          value={view}
          onValueChange={(value) => {
            if (isPageView(value)) {
              void navigate({ search: { view: value } });
            }
          }}
        >
          <TabsList className="detail-tabs" variant="line" aria-label="Page views">
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="links">Links</TabsTrigger>
            <TabsTrigger value="revisions">Revisions</TabsTrigger>
          </TabsList>
          <TabsContent value="preview">
            <div>
              <KnowledgePageMarkdown markdown={page.markdown} />
            </div>
          </TabsContent>
          <TabsContent value="links">
            <PageLinksView page={page} />
          </TabsContent>
          <TabsContent value="revisions">
            <PageRevisionsView page={page} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
