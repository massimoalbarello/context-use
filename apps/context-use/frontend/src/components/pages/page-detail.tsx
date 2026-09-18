import { Button } from '@repo/ui/button';
import { useState } from 'react';
import { useArchivePage } from '../../lib/hooks/use-archive-page';
import { usePage } from '../../lib/hooks/use-page';
import { useUpdatePage } from '../../lib/hooks/use-update-page';
import { temporalCoverageExpression } from '../../lib/temporal-coverage';
import type { KnowledgePage } from '../../queries/pages';
import { AssetLink } from '../assets/asset-link';
import { EntityLink } from '../entities/entity-link';
import { DetailHeader, DetailShell } from '../knowledge/detail-shell';
import { ResourceArchiveAction } from '../knowledge/resource-archive-action';
import { ResourceDetailActions } from '../knowledge/resource-detail-actions';
import { ResourceDetailHeading } from '../knowledge/resource-detail-heading';
import { ResourceList } from '../knowledge/resource-list';
import { WorkspaceResourceError } from '../knowledge/workspace-resource-error';
import { KnowledgePageForm } from '../pages/knowledge-page-form';
import { KnowledgePageLink } from '../pages/knowledge-page-link';
import { KnowledgePageMarkdown } from '../pages/knowledge-page-markdown';
import { KnowledgePageRevisions } from '../pages/knowledge-page-revisions';
import { TemporalCoverageLabel } from '../pages/temporal-coverage-label';
import { RecordLink } from '../records/record-link';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

type PageView = 'preview' | 'links' | 'revisions';

const PAGE_EDIT_FORM_ID = 'knowledge-page-edit-form';

function isPageView(value: unknown): value is PageView {
  return value === 'preview' || value === 'links' || value === 'revisions';
}

function PageLinkList({
  id,
  label,
  links,
  recordReferences = [],
}: {
  id?: string;
  label: string;
  links: KnowledgePage['references'];
  recordReferences?: KnowledgePage['recordReferences'];
}) {
  return (
    <section className="scroll-mt-24" id={id} tabIndex={id ? -1 : undefined}>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-semibold text-lg">{label}</h2>
        <Badge variant="secondary">{links.length + recordReferences.length}</Badge>
      </div>
      {links.length + recordReferences.length > 0 ? (
        <ResourceList>
          {links.map(({ page, fragment }) => (
            <li key={`${page.readableId}#${fragment ?? ''}`}>
              <KnowledgePageLink page={page} presentation="card" fragment={fragment ?? undefined} />
            </li>
          ))}
          {recordReferences.map((record) => (
            <li key={`record-${record.readableId}`}>
              {record.available ? (
                <RecordLink
                  record={{
                    readableId: record.readableId,
                    title: record.title ?? record.readableId,
                    source: { provider: record.provider, kind: record.kind },
                  }}
                />
              ) : (
                <p className="break-words text-muted-foreground text-sm">
                  Unavailable record · {record.readableId}
                </p>
              )}
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
              <li key={entity.readableId}>
                <EntityLink entity={entity} presentation="card" />
              </li>
            ))}
          </ResourceList>
        ) : (
          <p className="mt-2 text-muted-foreground text-sm">None yet.</p>
        )}
      </section>
      <PageLinkList
        label="References"
        links={page.references}
        recordReferences={page.recordReferences}
      />
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
                <li key={asset.readableId}>
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

export function KnowledgePageDetail({
  id,
  view = 'preview',
  onViewChange,
  onArchived,
}: {
  id: string;
  view?: PageView;
  onViewChange: (options: { view: PageView; hash?: string }) => void;
  onArchived: () => void;
}) {
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
    return (
      <p className="p-8 text-muted-foreground text-sm" role="status">
        Loading page…
      </p>
    );
  }
  const hasInboundUsages = page.backlinks.length > 0;
  const editActions = (
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
  );
  const viewActions = (
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
                  onArchived();
                } else {
                  setArchiveConflictVisible(true);
                }
              },
            },
          );
        }}
      />
    </ResourceDetailActions>
  );

  return (
    <DetailShell className={editing ? 'gap-4' : 'gap-0'} data-editing={editing}>
      {editing ? (
        <KnowledgePageForm
          key={page.revisionNumber}
          initialValues={{
            markdown: page.markdown,
            temporalCoverage: page.temporalCoverage
              ? temporalCoverageExpression(page.temporalCoverage)
              : null,
          }}
          formId={PAGE_EDIT_FORM_ID}
          pending={updatePage.isPending}
          error={updatePage.error}
          header={(intervalField) => (
            <DetailHeader>
              <ResourceDetailHeading actions={editActions} context={intervalField}>
                Knowledge page
              </ResourceDetailHeading>
              {page.recordReferences.some((record) => !record.available) && (
                <p className="text-muted-foreground text-sm" role="status">
                  The saved page has unavailable record references. You can keep or remove them when
                  saving your changes.
                </p>
              )}
            </DetailHeader>
          )}
          onSubmit={({ markdown, temporalCoverage }) =>
            updatePage.mutate(
              {
                readableId: page.readableId,
                body: {
                  expectedRevisionNumber: page.revisionNumber,
                  markdown,
                  ...(temporalCoverage === undefined ? {} : { temporalCoverage }),
                },
              },
              { onSuccess: () => setEditing(false) },
            )
          }
        />
      ) : (
        <>
          <DetailHeader>
            <ResourceDetailHeading
              actions={viewActions}
              context={
                page.temporalCoverage ? (
                  <TemporalCoverageLabel
                    className="w-fit text-sm"
                    expression={page.temporalCoverage}
                  />
                ) : null
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
            <div
              className="flex flex-wrap items-center gap-2 text-destructive text-sm"
              role="alert"
            >
              <span>This page can’t be archived until every incoming reference is removed.</span>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => {
                  onViewChange({ view: 'links', hash: 'referenced-by' });
                }}
              >
                Review referring pages
              </Button>
            </div>
          )}

          <Tabs
            className="mt-5 min-w-0"
            value={view}
            onValueChange={(value) => {
              if (isPageView(value)) {
                onViewChange({ view: value });
              }
            }}
          >
            <TabsList className="gap-5" variant="line" aria-label="Page views">
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="links">Links</TabsTrigger>
              <TabsTrigger value="revisions">Revisions</TabsTrigger>
            </TabsList>
            <TabsContent value="preview">
              <KnowledgePageMarkdown
                markdown={page.markdown}
                mentions={page.mentions}
                recordReferences={page.recordReferences}
              />
            </TabsContent>
            <TabsContent value="links">
              <PageLinksView page={page} />
            </TabsContent>
            <TabsContent value="revisions">
              <KnowledgePageRevisions page={page} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </DetailShell>
  );
}
