import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { useState } from 'react';
import { EntityLink } from '../components/entities/entity-link';
import { ResourceDetailHeading } from '../components/knowledge/resource-detail-heading';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { KnowledgePageForm } from '../components/pages/knowledge-page-form';
import { KnowledgePageLink } from '../components/pages/knowledge-page-link';
import { KnowledgePageMarkdown } from '../components/pages/knowledge-page-markdown';
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
        <span className="count-badge">{links.length}</span>
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
    <div
      className="page-connections"
      id="page-links-panel"
      role="tabpanel"
      aria-labelledby="page-links-tab"
    >
      <section className="link-section">
        <div className="section-heading">
          <h2>Mentions</h2>
          <span className="count-badge">{page.mentions.length}</span>
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
    <section
      className="page-revisions"
      id="page-revisions-panel"
      role="tabpanel"
      aria-labelledby="page-revisions-tab"
    >
      <div className="section-heading">
        <h2>Revisions</h2>
        <span className="count-badge">{page.revisions.length}</span>
      </div>
      <ol className="revision-list">
        {page.revisions.map((revision) => (
          <li key={revision.revisionNumber}>
            <div>
              <strong>Revision {revision.revisionNumber}</strong>
              {revision.revisionNumber === page.revisionNumber && (
                <span className="current-revision">Current</span>
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

function PageTabs({
  activeView,
  onChange,
}: {
  activeView: PageView;
  onChange: (view: PageView) => void;
}) {
  const tabs: Array<{ id: PageView; label: string }> = [
    { id: 'preview', label: 'Preview' },
    { id: 'links', label: 'Links' },
    { id: 'revisions', label: 'Revisions' },
  ];

  return (
    <div className="detail-tabs" role="tablist" aria-label="Page views">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`page-${tab.id}-tab`}
          type="button"
          role="tab"
          aria-selected={activeView === tab.id}
          aria-controls={`page-${tab.id}-panel`}
          tabIndex={activeView === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
              return;
            }
            event.preventDefault();
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            const currentIndex = tabs.findIndex(({ id }) => id === tab.id);
            const nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length];
            if (nextTab) {
              onChange(nextTab.id);
              document.getElementById(`page-${nextTab.id}-tab`)?.focus();
            }
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
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
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => {
                    updatePage.reset();
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="primary-action"
                  type="submit"
                  form={PAGE_EDIT_FORM_ID}
                  disabled={updatePage.isPending}
                >
                  {updatePage.isPending ? 'Saving…' : 'Save page'}
                </button>
              </>
            ) : (
              <button
                className="primary-action"
                type="button"
                onClick={() => {
                  updatePage.reset();
                  setEditing(true);
                }}
              >
                Edit page
              </button>
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
        <div className="detail-view">
          <PageTabs
            activeView={view}
            onChange={(view) => {
              void navigate({ search: { view } });
            }}
          />
          {view === 'preview' ? (
            <div id="page-preview-panel" role="tabpanel" aria-labelledby="page-preview-tab">
              <KnowledgePageMarkdown markdown={page.markdown} />
            </div>
          ) : view === 'links' ? (
            <PageLinksView page={page} />
          ) : (
            <PageRevisionsView page={page} />
          )}
        </div>
      )}
    </div>
  );
}
