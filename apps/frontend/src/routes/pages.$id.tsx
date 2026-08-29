import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { KnowledgePageForm } from '../components/pages/knowledge-page-form';
import { KnowledgePageMarkdown } from '../components/pages/knowledge-page-markdown';
import { useEntities } from '../lib/hooks/use-entities';
import { usePage } from '../lib/hooks/use-page';
import { usePages } from '../lib/hooks/use-pages';
import { useUpdatePage } from '../lib/hooks/use-update-page';
import { entitiesQueryOptions } from '../queries/entities';
import { pageQueryOptions, pagesQueryOptions } from '../queries/pages';

export const Route = createFileRoute('/pages/$id')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(pageQueryOptions(params.id)),
      context.queryClient.ensureQueryData(pagesQueryOptions),
      context.queryClient.ensureQueryData(entitiesQueryOptions),
    ]);
  },
  component: KnowledgePageRoute,
});

function PageLinkList({
  label,
  links,
}: {
  label: string;
  links: Array<{
    page: { id: string; readableId: string; title: string };
    fragment: string | null;
  }>;
}) {
  if (links.length === 0) {
    return null;
  }
  return (
    <section className="link-section">
      <h2>{label}</h2>
      <ul>
        {links.map(({ page, fragment }) => (
          <li key={`${page.id}#${fragment ?? ''}`}>
            <Link to="/pages/$id" params={{ id: page.readableId }} hash={fragment ?? undefined}>
              {page.title}
              {fragment ? ` · #${fragment}` : ''}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function KnowledgePageRoute() {
  const { id } = Route.useParams();
  const [editing, setEditing] = useState(false);
  const { data: page, error } = usePage(id);
  const { data: entities = [] } = useEntities();
  const { data: pages = [] } = usePages();
  const updatePage = useUpdatePage();

  if (error) {
    return <p className="page-shell error-message">{error.message}</p>;
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
          entities={entities}
          pages={pages.filter(({ id }) => id !== page.id)}
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
        <KnowledgePageMarkdown markdown={page.markdown} />
      )}

      {!editing && (
        <aside className="page-connections">
          {page.mentions.length > 0 && (
            <section className="link-section">
              <h2>Entities</h2>
              <ul>
                {page.mentions.map((entity) => (
                  <li key={entity.id}>
                    <Link to="/entities/$id" params={{ id: entity.readableId }}>
                      {entity.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <PageLinkList label="References" links={page.references} />
          <PageLinkList label="Referenced by" links={page.backlinks} />
        </aside>
      )}
    </div>
  );
}
