import type { ReactNode } from 'react';
import { Badge } from '../ui/badge';
import { DetailShell } from './detail-shell';
import { ResourceDetailHeading } from './resource-detail-heading';
import { ResourceUnarchiveAction } from './resource-unarchive-action';

export function ArchivedStatus({ archivedAt }: { archivedAt: Date }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
      <Badge variant="secondary">Archived</Badge>
      <time dateTime={archivedAt.toISOString()}>{archivedAt.toLocaleDateString()}</time>
    </span>
  );
}

export function ArchivedResourceDetail({
  resourceType,
  readableId,
  archivedAt,
  onUnarchived,
  children,
}: {
  resourceType: 'entity' | 'page' | 'asset';
  readableId: string;
  archivedAt: Date;
  onUnarchived: () => void;
  children: ReactNode;
}) {
  return (
    <DetailShell>
      <ResourceDetailHeading
        context={<ArchivedStatus archivedAt={archivedAt} />}
        actions={
          <ResourceUnarchiveAction
            key={`${resourceType}:${readableId}`}
            resourceType={resourceType}
            readableId={readableId}
            onUnarchived={onUnarchived}
          />
        }
      >
        {resourceType === 'entity'
          ? 'Entity'
          : resourceType === 'page'
            ? 'Knowledge page'
            : 'Asset'}
      </ResourceDetailHeading>
      {children}
    </DetailShell>
  );
}
