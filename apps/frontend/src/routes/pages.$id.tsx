import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { useState } from 'react';
import { AssetLink } from '../components/assets/asset-link';
import { EntityLink } from '../components/entities/entity-link';
import { DetailHeader, DetailShell } from '../components/knowledge/detail-shell';
import { ResourceArchiveAction } from '../components/knowledge/resource-archive-action';
import { ResourceDetailActions } from '../components/knowledge/resource-detail-actions';
import { ResourceDetailHeading } from '../components/knowledge/resource-detail-heading';
import { ResourceList } from '../components/knowledge/resource-list';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { KnowledgePageForm } from '../components/pages/knowledge-page-form';
import { KnowledgePageLink } from '../components/pages/knowledge-page-link';
import { KnowledgePageMarkdown } from '../components/pages/knowledge-page-markdown';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useArchivePage } from '../lib/hooks/use-archive-page';
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

function PageLinkList({
  id,
  label,
  links,
}: {
  id?: string;
  label: string;
  links: KnowledgePage['references'];
}) {
  return (
    <section className="scroll-mt-24" id={id} tabIndex={id ? -1 : undefined}>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-semibold text-lg">{label}</h2>
        <Badge variant="secondary">{links.length}</Badge>
      </div>
      {links.length > 0 ? (
        <ResourceList>
          {links.map(({ page, fragment }) => (
            <li key={`${page.id}#${fragment ?? ''}`}>
              <KnowledgePageLink page={page} presentation="card" fragment={fragment ?? undefined} />
            </li>
          ))}
        </ResourceList>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">None yet.</p>
      )}
    </section>
  );
}

function PageLinksView({ page }: { page: KnowledgePage }) {
  const embeddedAssets = page.assetUsages.filter((usage) => usage.presentation === 'embed');
  const attachedAssets = page.assetUsages.filter((usage) => usage.presentation === 'attachment');
  return (
    <div className="grid gap-8 py-7 md:grid-cols-2 xl:grid-cols-3">
      <section>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="font-semibold text-lg">Mentions</h2>
          <Badge variant="secondary">{page.mentions.length}</Badge>
        </div>
        {page.mentions.length > 0 ? (
          <ResourceList>
            {page.mentions.map((entity) => (
              <li key={entity.id}>
                <EntityLink entity={entity} presentation="card" />
              </li>
            ))}
          </ResourceList>
        ) : (
          <p className="mt-2 text-muted-foreground text-sm">None yet.</p>
        )}
      </section>
      <PageLinkList label="References" links={page.references} />
      <PageLinkList id="referenced-by" label="Referenced by" links={page.backlinks} />
      {[
        { label: 'Embedded assets', usages: embeddedAssets },
        { label: 'Attached assets', usages: attachedAssets },
      ].map(({ label, usages }) => (
        <section key={label}>
          <div className="mb-4 flex items-center gap-3">
            <h2 className="font-semibold text-lg">{label}</h2>
            <Badge variant="secondary">{usages.length}</Badge>
          </div>
          {usages.length > 0 ? (
            <ResourceList>
              {usages.map(({ asset }) => (
                <li key={asset.id}>
                  <AssetLink asset={asset} presentation="card" />
                </li>
              ))}
            </ResourceList>
          ) : (
            <p className="text-muted-foreground text-sm">None yet.</p>
          )}
        </section>
      ))}
    </div>
  );
}

function PageRevisionsView({ page }: { page: KnowledgePage }) {
  return (
    <section className="py-7">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-semibold text-lg">Revisions</h2>
        <Badge variant="secondary">{page.revisions.length}</Badge>
      </div>
      <ol className="grid max-w-3xl list-none gap-2 p-0">
        {page.revisions.map((revision) => (
          <li className="rounded-xl bg-muted px-4 py-3" key={revision.revisionNumber}>
            <div className="flex items-center gap-2">
              <strong className="font-semibold text-sm">Revision {revision.revisionNumber}</strong>
              {revision.revisionNumber === page.revisionNumber && (
                <Badge variant="secondary">Current</Badge>
              )}
            </div>
            <p className="mt-1 text-sm">{revision.title}</p>
            <time
              className="mt-1 block text-muted-foreground text-xs"
              dateTime={revision.createdAt.toISOString()}
            >
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
  return <KnowledgePageRouteContent key={id} id={id} />;
}

function KnowledgePageRouteContent({ id }: { id: string }) {
  const { view = 'preview' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [editing, setEditing] = useState(false);
  const { data: page, error, refetch } = usePage(id);
  const updatePage = useUpdatePage();
  const archivePage = useArchivePage();
  const [archiveConflictVisible, setArchiveConflictVisible] = useState(false);

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
  const hasInboundUsages = page.backlinks.length > 0;

  return (
    <DetailShell className={editing ? 'gap-4' : 'gap-0'} data-editing={editing}>
      <DetailHeader>
        <ResourceDetailHeading
          actions={
            editing ? (
              <ResourceDetailActions
                mode="edit"
                resource="page"
                form={PAGE_EDIT_FORM_ID}
                pending={updatePage.isPending}
                onCancel={() => {
                  updatePage.reset();
                  setEditing(false);
                }}
              />
            ) : (
              <ResourceDetailActions
                mode="view"
                resource="page"
                onEdit={() => {
                  updatePage.reset();
                  setArchiveConflictVisible(false);
                  setEditing(true);
                }}
              >
                <ResourceArchiveAction
                  blocked={hasInboundUsages}
                  pending={archivePage.isPending}
                  resource="page"
                  onBlocked={() => {
                    setArchiveConflictVisible(true);
                  }}
                  onConfirm={() => {
                    archivePage.mutate(
                      { readableId: page.readableId },
                      {
                        onSuccess: (result) => {
                          if (result.state === 'archived') {
                            void navigate({ to: '/pages' });
                          } else {
                            setArchiveConflictVisible(true);
                          }
                        },
                      },
                    );
                  }}
                />
              </ResourceDetailActions>
            )
          }
        >
          Knowledge page
        </ResourceDetailHeading>
      </DetailHeader>

      {archivePage.error && (
        <p className="text-destructive text-sm" role="alert">
          {archivePage.error.message}
        </p>
      )}

      {archiveConflictVisible && (
        <div className="flex flex-wrap items-center gap-2 text-destructive text-sm" role="alert">
          <span>This page can’t be archived until every incoming reference is removed.</span>
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => {
              void navigate({ search: { view: 'links' }, hash: 'referenced-by' });
            }}
          >
            Review referring pages
          </Button>
        </div>
      )}

      {editing ? (
        <KnowledgePageForm
          key={page.revisionNumber}
          initialValues={{ markdown: page.markdown }}
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
          className="mt-5 min-w-0"
          value={view}
          onValueChange={(value) => {
            if (isPageView(value)) {
              void navigate({ search: { view: value } });
            }
          }}
        >
          <TabsList className="gap-5" variant="line" aria-label="Page views">
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
    </DetailShell>
  );
}
