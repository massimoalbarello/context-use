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
    <main className="page-shell page-shell-reading">
      <header className="page-toolbar">
        <p className="eyebrow">
          Page · {page.readableId} · revision {page.revisionNumber} · updated{' '}
          {page.updatedAt.toLocaleString()}
        </p>
        <div className="action-row">
          <Link className="secondary-action" to="/pages">
            All pages
          </Link>
          <button className="primary-action" type="button" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel edit' : 'Edit page'}
          </button>
        </div>
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
    </main>
  );
}
