import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { useState } from 'react';
import { EntityIdentityEditor } from '../components/entities/entity-identity-editor';
import { EntityImageEditor } from '../components/entities/entity-image-editor';
import { EntityAvatar } from '../components/entities/entity-link';
import { DetailHeader, DetailShell } from '../components/knowledge/detail-shell';
import { ResourceArchiveAction } from '../components/knowledge/resource-archive-action';
import { ResourceDetailActions } from '../components/knowledge/resource-detail-actions';
import { ResourceDetailHeading } from '../components/knowledge/resource-detail-heading';
import { ResourceList } from '../components/knowledge/resource-list';
import { ResourceName } from '../components/knowledge/resource-name';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { KnowledgePageLink } from '../components/pages/knowledge-page-link';
import { Badge } from '../components/ui/badge';
import { useArchiveEntity } from '../lib/hooks/use-archive-entity';
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
  return <EntityRouteContent key={id} id={id} />;
}

function EntityRouteContent({ id }: { id: string }) {
  const { data: entity, error, refetch } = useEntity(id);
  const updateEntity = useUpdateEntity();
  const archiveEntity = useArchiveEntity();
  const [editing, setEditing] = useState(false);
  const [imageEditing, setImageEditing] = useState(false);
  const [archiveConflictVisible, setArchiveConflictVisible] = useState(false);
  const navigate = Route.useNavigate();

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
  const hasInboundUsages = entity.pages.length > 0;

  return (
    <DetailShell>
      {editing ? (
        <div className="grid gap-5">
          <EntityIdentityEditor
            name={entity.name}
            description={entity.description}
            isSelf={entity.isSelf}
            image={entity.image}
            imageEditorOpen={imageEditing}
            pending={updateEntity.isPending}
            error={updateEntity.error}
            onEditImage={() => setImageEditing((visible) => !visible)}
            onCancel={() => {
              updateEntity.reset();
              setImageEditing(false);
              setEditing(false);
            }}
            onSubmit={(identity) =>
              updateEntity.mutate(
                { readableId: entity.readableId, body: identity },
                {
                  onSuccess: () => {
                    setImageEditing(false);
                    setEditing(false);
                  },
                },
              )
            }
          />
          {imageEditing && (
            <EntityImageEditor entity={entity} onDone={() => setImageEditing(false)} />
          )}
        </div>
      ) : (
        <DetailHeader>
          <ResourceDetailHeading
            actions={
              <ResourceDetailActions
                mode="view"
                resource="entity"
                onEdit={() => {
                  updateEntity.reset();
                  setArchiveConflictVisible(false);
                  setImageEditing(false);
                  setEditing(true);
                }}
              >
                {!entity.isSelf && (
                  <ResourceArchiveAction
                    blocked={hasInboundUsages}
                    pending={archiveEntity.isPending}
                    resource="entity"
                    onBlocked={() => {
                      setArchiveConflictVisible(true);
                    }}
                    onConfirm={() => {
                      archiveEntity.mutate(
                        { readableId: entity.readableId },
                        {
                          onSuccess: (result) => {
                            if (result.state === 'archived') {
                              void navigate({ to: '/entities' });
                            } else {
                              setArchiveConflictVisible(true);
                            }
                          },
                        },
                      );
                    }}
                  />
                )}
              </ResourceDetailActions>
            }
          >
            Entity {entity.isSelf && <Badge variant="secondary">You</Badge>}
          </ResourceDetailHeading>
          <div className="flex w-full min-w-0 max-w-3xl flex-col gap-5 sm:flex-row sm:items-start">
            <EntityAvatar entity={entity} className="size-24 text-3xl" />
            <div className="min-w-0 flex-1">
              <ResourceName>{entity.name}</ResourceName>
              <p className="mt-3 max-w-2xl text-lg text-muted-foreground leading-relaxed">
                {entity.description}
              </p>
            </div>
          </div>
        </DetailHeader>
      )}

      {archiveEntity.error && (
        <p className="text-destructive text-sm" role="alert">
          {archiveEntity.error.message}
        </p>
      )}

      {!entity.isSelf && archiveConflictVisible && (
        <p className="text-destructive text-sm" role="alert">
          This entity can’t be archived until every mention is removed or replaced.{' '}
          <a className="font-medium underline" href="#mentioned-by">
            Review mentions
          </a>
          .
        </p>
      )}

      <section className="max-w-3xl scroll-mt-24 pt-2" id="mentioned-by" tabIndex={-1}>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="font-semibold text-lg">Mentioned by</h2>
          <Badge variant="secondary">{entity.pages.length}</Badge>
        </div>
        {entity.pages.length > 0 ? (
          <ResourceList>
            {entity.pages.map((page) => (
              <li key={page.readableId}>
                <KnowledgePageLink page={page} presentation="card" />
              </li>
            ))}
          </ResourceList>
        ) : (
          <p className="mt-2 text-muted-foreground text-sm">None yet.</p>
        )}
      </section>
    </DetailShell>
  );
}
