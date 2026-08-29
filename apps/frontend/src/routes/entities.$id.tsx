import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { EntityForm } from '../components/entities/entity-form';
import { KnowledgePageList } from '../components/pages/knowledge-page-list';
import { useEntity } from '../lib/hooks/use-entity';
import { useUpdateEntity } from '../lib/hooks/use-update-entity';
import { entityQueryOptions } from '../queries/entities';

export const Route = createFileRoute('/entities/$id')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(entityQueryOptions(params.id)),
  component: EntityRoute,
});

function EntityRoute() {
  const { id } = Route.useParams();
  const { data: entity, error } = useEntity(id);
  const updateEntity = useUpdateEntity();
  const [editing, setEditing] = useState(false);

  if (error) {
    return <p className="page-shell error-message">{error.message}</p>;
  }
  if (!entity) {
    return null;
  }

  return (
    <div className="detail-shell entity-detail">
      <header className="detail-header">
        <div>
          <p className="eyebrow">
            Entity {entity.isSelf && <span className="self-badge">You</span>}
          </p>
          <h1>{entity.name}</h1>
          <p className="detail-description">{entity.description}</p>
          <code className="entity-address">context-use://entity/{entity.readableId}</code>
        </div>
        <button
          className={editing ? 'secondary-action' : 'primary-action'}
          type="button"
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Cancel' : 'Edit entity'}
        </button>
      </header>

      {editing ? (
        <div className="editor-shell-narrow">
          <EntityForm
            key={entity.updatedAt.toISOString()}
            initialValues={{
              readableId: entity.readableId,
              name: entity.name,
              description: entity.description,
            }}
            readableIdLocked
            pending={updateEntity.isPending}
            error={updateEntity.error}
            submitLabel="Save identity"
            onSubmit={({ name, description }) =>
              updateEntity.mutate(
                {
                  readableId: entity.readableId,
                  body: { name, description },
                },
                { onSuccess: () => setEditing(false) },
              )
            }
          />
        </div>
      ) : (
        <section className="entity-pages">
          <div className="section-heading">
            <h2>Mentioned by</h2>
            <span className="count-badge">{entity.pages.length}</span>
          </div>
          <KnowledgePageList pages={entity.pages} />
        </section>
      )}
    </div>
  );
}
