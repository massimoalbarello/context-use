import { cn } from '@repo/ui/class-names';
import { useState } from 'react';
import { ENTITY_TYPE_LABELS } from '#backend/models/entities/model.ts';
import { useArchiveEntity } from '../../lib/hooks/use-archive-entity';
import { useEntity } from '../../lib/hooks/use-entity';
import { useUpdateEntity } from '../../lib/hooks/use-update-entity';
import { EntityIdentityEditor } from '../entities/entity-identity-editor';
import { EntityImageEditor } from '../entities/entity-image-editor';
import { EntityAvatar } from '../entities/entity-link';
import { EntityPageSections } from '../entities/entity-page-sections';
import { PersonImages } from '../faces/person-faces';
import { DetailHeader, DetailShell } from '../knowledge/detail-shell';
import { ResourceArchiveAction } from '../knowledge/resource-archive-action';
import { ResourceDetailActions } from '../knowledge/resource-detail-actions';
import { ResourceDetailHeading } from '../knowledge/resource-detail-heading';
import { ResourceName } from '../knowledge/resource-name';
import { WorkspaceResourceError } from '../knowledge/workspace-resource-error';
import { Badge } from '../ui/badge';
export function EntityDetail({ id, onArchived }: { id: string; onArchived: () => void }) {
  const { data: entity, error, refetch } = useEntity(id);
  const updateEntity = useUpdateEntity();
  const archiveEntity = useArchiveEntity();
  const [editing, setEditing] = useState(false);
  const [imageEditing, setImageEditing] = useState(false);
  const [archiveConflictVisible, setArchiveConflictVisible] = useState(false);

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
    return (
      <p className="p-8 text-muted-foreground text-sm" role="status">
        Loading entity…
      </p>
    );
  }
  const hasInboundUsages = entity.pages.length > 0;

  return (
    <DetailShell>
      {editing ? (
        <div className="grid gap-5">
          <EntityIdentityEditor
            name={entity.name}
            description={entity.description}
            entityType={entity.entityType}
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
                              onArchived();
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
            {entity.entityType ? ENTITY_TYPE_LABELS[entity.entityType] : 'Entity'}{' '}
            {entity.isSelf && <Badge variant="secondary">You</Badge>}
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

      <div
        className={cn('grid items-start gap-8', entity.entityType === 'person' && 'md:grid-cols-2')}
      >
        <EntityPageSections pages={entity.pages} />
        {entity.entityType === 'person' && <PersonImages readableId={id} />}
      </div>
    </DetailShell>
  );
}
