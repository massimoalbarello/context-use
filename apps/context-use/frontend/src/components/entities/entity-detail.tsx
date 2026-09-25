import { Button, buttonVariants } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ENTITY_TYPE_LABELS } from '#backend/models/entities/model.ts';
import { useArchiveEntity } from '../../lib/hooks/use-archive-entity';
import { useEntity } from '../../lib/hooks/use-entity';
import { usePublicationApproval } from '../../lib/hooks/use-publication-approval';
import { useUpdateEntity } from '../../lib/hooks/use-update-entity';
import type { EntityDetail as Entity } from '../../queries/entities';
import { publicationStatusQueryOptions } from '../../queries/publications';
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
import { PublicationReviewDialog } from '../publications/publication-review-dialog';
import { PublicationStatus } from '../publications/publication-status';
import { Badge } from '../ui/badge';
export function EntityDetail({ id, onArchived }: { id: string; onArchived: () => void }) {
  const { data: entity, error, refetch } = useEntity(id);

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
  return <EntityDetailContent key={entity.readableId} entity={entity} onArchived={onArchived} />;
}

function EntityDetailContent({ entity, onArchived }: { entity: Entity; onArchived: () => void }) {
  const archiveEntity = useArchiveEntity();
  const publication = useQuery(
    publicationStatusQueryOptions({ resourceType: 'entity', readableId: entity.readableId }),
  );
  const approval = usePublicationApproval();
  const [editing, setEditing] = useState(false);
  const [archiveConflict, setArchiveConflict] = useState<'publication' | 'mentions' | null>(null);
  const hasInboundUsages = entity.pages.length > 0;
  const isPublic = !publication.isError && publication.data?.publishedAt != null;

  return (
    <DetailShell>
      {editing ? (
        <EntityEditing entity={entity} publication={publication} onDone={() => setEditing(false)} />
      ) : (
        <DetailHeader>
          <ResourceDetailHeading
            context={<PublicationStatus query={publication} />}
            actions={
              <ResourceDetailActions
                mode="view"
                resource="entity"
                onEdit={() => {
                  setArchiveConflict(null);
                  setEditing(true);
                }}
              >
                {publication.isSuccess && (
                  <EntityPublicationActions
                    publicId={isPublic ? publication.data.publicId : null}
                    isPublic={isPublic}
                    unavailable={!!approval.request}
                    onReview={() => {
                      setArchiveConflict(null);
                      approval.review({
                        resourceType: 'entity',
                        readableId: entity.readableId,
                        action: isPublic ? 'unpublish' : 'publish',
                      });
                    }}
                  />
                )}
                {!entity.isSelf && (
                  <ResourceArchiveAction
                    blocked={isPublic || hasInboundUsages}
                    pending={archiveEntity.isPending}
                    resource="entity"
                    onBlocked={() => {
                      setArchiveConflict(isPublic ? 'publication' : 'mentions');
                    }}
                    onConfirm={() => {
                      archiveEntity.mutate(
                        { readableId: entity.readableId },
                        {
                          onSuccess: (result) => {
                            if (result.state === 'archived') {
                              onArchived();
                            } else {
                              setArchiveConflict('mentions');
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

      {!entity.isSelf && archiveConflict && <EntityArchiveConflict reason={archiveConflict} />}

      <EntityPublicationReview approval={approval} />

      <div
        className={cn('grid items-start gap-8', entity.entityType === 'person' && 'md:grid-cols-2')}
      >
        <EntityPageSections pages={entity.pages} />
        {entity.entityType === 'person' && <PersonImages readableId={entity.readableId} />}
      </div>
    </DetailShell>
  );
}

function EntityArchiveConflict({ reason }: { reason: 'publication' | 'mentions' }) {
  return (
    <p className="text-destructive text-sm" role="alert">
      {reason === 'publication' ? (
        'Unpublish this entity before archiving it.'
      ) : (
        <>
          This entity can’t be archived until every mention is removed or replaced.{' '}
          <a className="font-medium underline" href="#mentioned-by">
            Review mentions
          </a>
          .
        </>
      )}
    </p>
  );
}

function EntityPublicationReview({
  approval,
}: {
  approval: ReturnType<typeof usePublicationApproval>;
}) {
  const preparation = approval.ready?.preparation;
  const identity = preparation?.entityIdentity;
  const image = preparation?.includedImage;
  return (
    <PublicationReviewDialog approval={approval}>
      {approval.request?.action === 'unpublish' ? (
        <p className="text-sm">
          The public entity and its page index will stop being available. Unpublishing this entity
          does not unpublish its image assets. Unpublish those assets separately when needed.
        </p>
      ) : (
        <>
          {preparation && identity && (
            <div className="flex min-w-0 items-start gap-4">
              <EntityAvatar
                entity={{ name: preparation.resource.name, image: image?.resource ?? null }}
                className="size-16 shrink-0 text-xl"
              />
              <div className="grid min-w-0 gap-2">
                <p className="text-muted-foreground text-sm">
                  {identity.entityType ? ENTITY_TYPE_LABELS[identity.entityType] : 'Untyped'}
                </p>
                <p className="break-words text-sm">{identity.description}</p>
              </div>
            </div>
          )}
          <p className="text-sm">
            Anyone with the public link can view this entity and its public page index. Saved
            changes to its name, description, and type appear publicly.
          </p>
          {image ? (
            <p className="break-words text-sm">
              {image.publication.publishedAt
                ? `Its image “${image.resource.name}” is already public.`
                : `This also publishes the entire image asset “${image.resource.name}”. Anyone with its public link can view or download the original file.`}{' '}
              The image remains public after you unpublish this entity, until you unpublish the
              asset separately.
            </p>
          ) : (
            <p className="text-sm">This entity has no image.</p>
          )}
        </>
      )}
    </PublicationReviewDialog>
  );
}

function EntityPublicationActions({
  publicId,
  isPublic,
  unavailable,
  onReview,
}: {
  publicId: string | null;
  isPublic: boolean;
  unavailable: boolean;
  onReview: () => void;
}) {
  return (
    <>
      {publicId && (
        <a
          className={buttonVariants({ variant: 'outline', size: 'lg' })}
          href={`/public/entities/${encodeURIComponent(publicId)}`}
          target="_blank"
          rel="noreferrer"
        >
          View public
        </a>
      )}
      <Button variant="outline" size="lg" disabled={unavailable} onClick={onReview}>
        {isPublic ? 'Unpublish' : 'Publish'}
      </Button>
    </>
  );
}

function EntityEditing({
  entity,
  publication,
  onDone,
}: {
  entity: Entity;
  publication: UseQueryResult<{ publishedAt: string | null }>;
  onDone: () => void;
}) {
  const updateEntity = useUpdateEntity();
  const [imageEditing, setImageEditing] = useState(false);
  const isPublic = !publication.isError && publication.data?.publishedAt != null;
  return (
    <div className="grid gap-5">
      <EntityIdentityEditor
        context={<PublicationStatus query={publication} />}
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
          onDone();
        }}
        onSubmit={(identity) =>
          updateEntity.mutate(
            { readableId: entity.readableId, body: identity },
            {
              onSuccess: () => {
                setImageEditing(false);
                onDone();
              },
            },
          )
        }
      >
        {isPublic && (
          <p className="text-muted-foreground text-sm">
            This entity is public. Saved changes to its name, description, and type appear publicly.
          </p>
        )}
      </EntityIdentityEditor>
      {imageEditing &&
        (publication.isSuccess ? (
          <EntityImageEditor
            key={isPublic ? 'public' : 'private'}
            entity={entity}
            isPublic={isPublic}
            onDone={() => setImageEditing(false)}
          />
        ) : (
          <p id="entity-image-editor" className="text-muted-foreground text-sm">
            Resolve publication status before choosing an image.
          </p>
        ))}
    </div>
  );
}
