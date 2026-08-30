import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { useState } from 'react';
import { EntityIdentityEditor } from '../components/entities/entity-identity-editor';
import { ResourceDetailHeading } from '../components/knowledge/resource-detail-heading';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { KnowledgePageLink } from '../components/pages/knowledge-page-link';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { useEntity } from '../lib/hooks/use-entity';
import { useUpdateEntity } from '../lib/hooks/use-update-entity';
import { entityQueryOptions } from '../queries/entities';

export const Route = createFileRoute('/entities/$id')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(entityQueryOptions(params.id)),
  errorComponent: EntityRouteError,
  component: EntityRoute,
});

function EntityRouteError({ error, reset }: ErrorComponentProps) {
  return <WorkspaceResourceError resource="entity" error={error} retry={reset} />;
}

function EntityRoute() {
  const { id } = Route.useParams();
  const { data: entity, error, refetch } = useEntity(id);
  const updateEntity = useUpdateEntity();
  const [editing, setEditing] = useState(false);

  if (error) {
    return (
      <WorkspaceResourceError
        resource="entity"
        error={error}
        retry={() => {
          void refetch();
        }}
      />
    );
  }
  if (!entity) {
    return null;
  }

  return (
    <div className="detail-shell entity-detail">
      {editing ? (
        <EntityIdentityEditor
          key={entity.updatedAt.toISOString()}
          name={entity.name}
          description={entity.description}
          isSelf={entity.isSelf}
          pending={updateEntity.isPending}
          error={updateEntity.error}
          onCancel={() => {
            updateEntity.reset();
            setEditing(false);
          }}
          onSubmit={(identity) =>
            updateEntity.mutate(
              { readableId: entity.readableId, body: identity },
              { onSuccess: () => setEditing(false) },
            )
          }
        />
      ) : (
        <header className="detail-header">
          <ResourceDetailHeading
            actions={
              <Button
                size="lg"
                type="button"
                onClick={() => {
                  updateEntity.reset();
                  setEditing(true);
                }}
              >
                Edit entity
              </Button>
            }
          >
            Entity {entity.isSelf && <Badge variant="secondary">You</Badge>}
          </ResourceDetailHeading>
          <div className="entity-identity">
            <h1>{entity.name}</h1>
            <p className="detail-description">{entity.description}</p>
          </div>
        </header>
      )}

      <section className="entity-pages">
        <div className="section-heading">
          <h2>Mentioned by</h2>
          <Badge variant="secondary">{entity.pages.length}</Badge>
        </div>
        {entity.pages.length > 0 ? (
          <ul className="object-card-list">
            {entity.pages.map((page) => (
              <li key={page.id}>
                <KnowledgePageLink page={page} presentation="card" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="connection-empty">None yet.</p>
        )}
      </section>
    </div>
  );
}
