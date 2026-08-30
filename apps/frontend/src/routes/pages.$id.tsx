import { createFileRoute, type ErrorComponentProps, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { EntityLink } from '../components/entities/entity-link';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { KnowledgePageForm } from '../components/pages/knowledge-page-form';
import { KnowledgePageLink } from '../components/pages/knowledge-page-link';
import { KnowledgePageMarkdown } from '../components/pages/knowledge-page-markdown';
import { usePage } from '../lib/hooks/use-page';
import { useUpdatePage } from '../lib/hooks/use-update-page';
import { type KnowledgePage, pageQueryOptions } from '../queries/pages';

export const Route = createFileRoute('/pages/$id')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
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

type PageView = 'preview' | 'links' | 'revisions';

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
  const [editing, setEditing] = useState(false);
  const [activeView, setActiveView] = useState<PageView>('preview');
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
    <div className="detail-shell page-detail">
      <header className="detail-toolbar">
        <div>
          <p className="eyebrow">Knowledge page</p>
          <p className="detail-meta">
            <code>{page.readableId}</code> · revision {page.revisionNumber} · updated{' '}
            {page.updatedAt.toLocaleString()}
          </p>
        </div>
        <button
          className={editing ? 'secondary-action' : 'primary-action'}
          type="button"
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Cancel' : 'Edit page'}
        </button>
      </header>

      {editing ? (
        <KnowledgePageForm
          key={page.revisionNumber}
          initialValues={{ readableId: page.readableId, markdown: page.markdown }}
          readableIdLocked
          pending={updatePage.isPending}
          error={updatePage.error}
          submitLabel="Save new revision"
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
          <PageTabs activeView={activeView} onChange={setActiveView} />
          {activeView === 'preview' ? (
            <div id="page-preview-panel" role="tabpanel" aria-labelledby="page-preview-tab">
              <KnowledgePageMarkdown markdown={page.markdown} />
            </div>
          ) : activeView === 'links' ? (
            <PageLinksView page={page} />
          ) : (
            <PageRevisionsView page={page} />
          )}
        </div>
      )}
    </div>
  );
}
