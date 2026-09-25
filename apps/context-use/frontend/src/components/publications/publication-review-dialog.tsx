import { Button } from '@repo/ui/button';
import type { ReactNode } from 'react';
import type { usePublicationApproval } from '../../lib/hooks/use-publication-approval';
import { type PublicationBlocker, PublicationError } from '../../queries/publications';
import { AssetLink } from '../assets/asset-link';
import { EntityLink } from '../entities/entity-link';
import { KnowledgePageLink } from '../pages/knowledge-page-link';
import { RecordLink } from '../records/record-link';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { FieldError } from '../ui/field';

const blockerExplanations: Record<PublicationBlocker['reason'], string> = {
  public_page_reference: 'Unpublish this page first; its public revision uses this resource.',
  public_entity_image: 'Unpublish this entity or replace its image first.',
  image_unavailable: 'This image is unavailable. Choose an available image first.',
  reference_not_public: 'Publish this referenced resource first.',
  reference_unavailable: 'Remove or replace this unavailable reference first.',
  record_reference:
    'Pages that reference records cannot be published. Remove this reference first.',
};

function BlockerLink({ resource }: Pick<PublicationBlocker, 'resource'>) {
  switch (resource.resourceType) {
    case 'asset':
      return <AssetLink asset={resource} presentation="inline" />;
    case 'entity':
      return <EntityLink entity={resource} presentation="inline" />;
    case 'page':
      return (
        <KnowledgePageLink
          page={{ readableId: resource.readableId, title: resource.name }}
          presentation="inline"
        />
      );
    case 'record':
      return (
        <RecordLink
          record={{ readableId: resource.readableId, title: resource.name }}
          presentation="inline"
        />
      );
  }
}

export function PublicationReviewDialog({
  approval,
  children,
  confirmDisabled = false,
}: {
  approval: ReturnType<typeof usePublicationApproval>;
  children?: ReactNode;
  confirmDisabled?: boolean;
}) {
  const { request, ready, error } = approval;
  const blockers = error instanceof PublicationError ? error.blockers : [];
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && approval.close()}>
      <DialogContent>
        <DialogTitle>
          {request?.action === 'unpublish' ? 'Unpublish' : 'Publish'} {request?.resourceType}
        </DialogTitle>
        {approval.preparing && <p role="status">Preparing your review…</p>}
        {ready && (
          <div className="grid min-w-0 gap-4">
            <p className="break-words font-semibold">{ready.preparation.resource.name}</p>
            {children}
          </div>
        )}
        {error && <FieldError>{error.message}</FieldError>}
        {blockers.length > 0 && (
          <ul className="grid gap-4 text-sm">
            {blockers.map((blocker) => (
              <li
                key={`${blocker.reason}:${blocker.resource.resourceType}:${blocker.resource.readableId}`}
              >
                <BlockerLink resource={blocker.resource} />
                <p className="mt-1 text-muted-foreground">{blockerExplanations[blocker.reason]}</p>
              </li>
            ))}
          </ul>
        )}
        {approval.ceremonyError && <FieldError>{approval.ceremonyError}</FieldError>}
        {approval.expired && (
          <p role="alert" className="text-sm">
            This review has expired. Review again before confirming.
          </p>
        )}
        {ready && !approval.needsReview && (
          <p className="text-muted-foreground text-sm">
            Confirm this operation with your passkey. This review expires shortly; if anything
            changes, you’ll need to review again.
          </p>
        )}
        <ReviewActions approval={approval} confirmDisabled={confirmDisabled} />
      </DialogContent>
    </Dialog>
  );
}

function ReviewActions({
  approval,
  confirmDisabled,
}: {
  approval: ReturnType<typeof usePublicationApproval>;
  confirmDisabled: boolean;
}) {
  const { request, ready } = approval;
  const pending = approval.preparing || approval.authenticating || approval.completing;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline" onClick={approval.close}>
        {approval.completing ? 'Close' : 'Cancel'}
      </Button>
      {approval.needsReview ? (
        <Button disabled={pending} onClick={() => request && approval.review(request)}>
          Review again
        </Button>
      ) : (
        <Button
          disabled={!ready || pending || confirmDisabled}
          onClick={() => void approval.confirm()}
        >
          {approval.authenticating
            ? 'Waiting for passkey…'
            : approval.completing
              ? 'Applying…'
              : 'Confirm with passkey'}
        </Button>
      )}
    </div>
  );
}
