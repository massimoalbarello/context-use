import { Button } from '@repo/ui/button';
import { ArchiveRestore } from 'lucide-react';
import { useRef } from 'react';
import type { UnarchiveBlocker } from '#backend/models/resource-archiving/model.ts';
import { useUnarchiveResource } from '../../lib/hooks/use-unarchive-resource';
import { AssetLink } from '../assets/asset-link';
import { EntityLink } from '../entities/entity-link';
import { KnowledgePageLink } from '../pages/knowledge-page-link';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { FieldError } from '../ui/field';

export function ResourceUnarchiveAction({
  resourceType,
  readableId,
  onUnarchived,
}: {
  resourceType: 'entity' | 'page' | 'asset';
  readableId: string;
  onUnarchived: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const mutation = useUnarchiveResource({ resourceType, onUnarchived });
  const blockers = mutation.data?.state === 'dependencies_archived' ? mutation.data.blockers : [];
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        size="lg"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ readableId })}
      >
        <ArchiveRestore aria-hidden="true" />
        {mutation.isPending ? 'Unarchiving…' : 'Unarchive'}
      </Button>
      <Dialog
        open={mutation.isError || blockers.length > 0}
        onOpenChange={(open) => !open && mutation.reset()}
      >
        <DialogContent className="max-w-md" finalFocus={trigger}>
          <DialogTitle>Unarchive {resourceType}</DialogTitle>
          {mutation.error && <FieldError>{mutation.error.message}</FieldError>}
          {blockers.length > 0 && (
            <div className="grid min-w-0 gap-3 text-sm">
              <p role="alert">Unarchive these resources first:</p>
              <ul className="grid gap-2">
                {blockers.map((blocker) => (
                  <li key={`${blocker.resourceType}:${blocker.readableId}`}>
                    <UnarchiveDependency resource={blocker} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => mutation.reset()}>OK</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UnarchiveDependency({ resource }: { resource: UnarchiveBlocker }) {
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
  }
}
