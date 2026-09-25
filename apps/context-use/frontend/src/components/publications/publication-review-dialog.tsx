import { Collapsible } from '@base-ui/react/collapsible';
import { Button } from '@repo/ui/button';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import type { usePublicationApproval } from '../../lib/hooks/use-publication-approval';
import {
  type PublicationBlocker,
  PublicationError,
  type PublicationRequest,
} from '../../queries/publications';
import { AssetLink } from '../assets/asset-link';
import { EntityLink } from '../entities/entity-link';
import { KnowledgePageLink } from '../pages/knowledge-page-link';
import { RecordLink } from '../records/record-link';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { FieldError } from '../ui/field';

const blockerExplanations: Record<PublicationBlocker['reason'], string> = {
  public_page_reference:
    'Unpublish this referring page or publish a revision of it without this reference first.',
  public_entity_image: 'Unpublish this entity or replace its image first.',
  image_unavailable: 'This image is unavailable. Choose an available image first.',
  reference_not_public: 'Publish this referenced resource first.',
  reference_unavailable: 'Remove or replace this unavailable reference first.',
  public_record_reference: 'Unpublish this referring record or remove its reference first.',
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

function groupBlockers({
  blockers,
  request,
}: {
  blockers: PublicationBlocker[];
  request: PublicationRequest | null;
}) {
  const privateResources: PublicationBlocker['resource'][] = [];
  const otherBlockers: PublicationBlocker[] = [];
  for (const blocker of blockers) {
    if (
      request?.action === 'publish' &&
      request.resourceType === 'page' &&
      blocker.reason === 'reference_not_public' &&
      !(
        blocker.resource.resourceType === 'page' &&
        blocker.resource.readableId === request.readableId
      )
    ) {
      privateResources.push(blocker.resource);
    } else {
      otherBlockers.push(blocker);
    }
  }
  return { privateResources, otherBlockers };
}

export function PublicationReviewDialog({
  approval,
  children,
  confirmDisabled = false,
  className,
}: {
  approval: ReturnType<typeof usePublicationApproval>;
  children?: ReactNode;
  confirmDisabled?: boolean;
  className?: string;
}) {
  const { request, ready, error } = approval;
  const blockers = error instanceof PublicationError ? error.blockers : [];
  const { privateResources, otherBlockers } = groupBlockers({ blockers, request });
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && approval.close()}>
      <DialogContent className={blockers.length > 0 ? 'max-w-md' : className}>
        <DialogTitle>
          {request?.action === 'unpublish' ? 'Unpublish' : 'Publish'} {request?.resourceType}
        </DialogTitle>
        {approval.preparing && <p role="status">Preparing your review…</p>}
        {ready && blockers.length === 0 && (
          <div className="grid min-w-0 gap-4">
            <p className="break-words font-semibold">{ready.preparation.resource.name}</p>
            {children}
          </div>
        )}
        {error && privateResources.length === 0 && <FieldError>{error.message}</FieldError>}
        {privateResources.length > 0 && (
          <div className="grid min-w-0 gap-3 text-sm">
            <p role="alert">Publish all resources referenced in this page before publishing it.</p>
            <BlockerDisclosure
              label={`${privateResources.length} private ${privateResources.length === 1 ? 'resource' : 'resources'}`}
            >
              <ul className="grid gap-2">
                {privateResources.map((resource) => (
                  <li key={`${resource.resourceType}:${resource.readableId}`}>
                    <BlockerLink resource={resource} />
                  </li>
                ))}
              </ul>
            </BlockerDisclosure>
          </div>
        )}
        {otherBlockers.length > 0 && <OtherBlockers blockers={otherBlockers} request={request} />}
        {approval.ceremonyError && <FieldError>{approval.ceremonyError}</FieldError>}
        {approval.expired && (
          <p role="alert" className="text-sm">
            This review has expired. Review again before confirming.
          </p>
        )}
        <ReviewActions approval={approval} confirmDisabled={confirmDisabled} />
      </DialogContent>
    </Dialog>
  );
}

function BlockerDisclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Collapsible.Root className="min-w-0 text-sm">
      <Collapsible.Trigger render={<Button variant="ghost" size="sm" />} className="group -ml-2">
        {label}
        <ChevronDown className="size-4 transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="max-h-48 overflow-y-auto break-words pr-2">
        <div className="pt-2">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function OtherBlockers({
  blockers,
  request,
}: {
  blockers: PublicationBlocker[];
  request: PublicationRequest | null;
}) {
  const list = (
    <ul className="grid gap-4 text-sm">
      {blockers.map((blocker) => (
        <li
          key={`${blocker.reason}:${blocker.resource.resourceType}:${blocker.resource.readableId}`}
        >
          <BlockerLink resource={blocker.resource} />
          <p className="mt-1 text-muted-foreground">
            {blocker.reason === 'reference_not_public' &&
            request?.resourceType === 'page' &&
            blocker.resource.resourceType === 'page' &&
            blocker.resource.readableId === request.readableId
              ? 'Publish a revision without this self-reference first.'
              : blockerExplanations[blocker.reason]}
          </p>
        </li>
      ))}
    </ul>
  );
  return request?.action === 'publish' && request.resourceType === 'page' ? (
    <BlockerDisclosure
      label={`${blockers.length} ${blockers.length === 1 ? 'reference' : 'references'} to fix`}
    >
      {list}
    </BlockerDisclosure>
  ) : (
    list
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
