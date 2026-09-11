import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { DetailHeader, DetailShell } from '../components/knowledge/detail-shell';
import { ResourceDetailHeading } from '../components/knowledge/resource-detail-heading';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { ExternalRecordMarkdown } from '../components/records/external-record-markdown';
import { RecordTimestamp } from '../components/records/record-timestamp';
import { Badge } from '../components/ui/badge';
import { useRecord } from '../lib/hooks/use-records';
import { recordQueryOptions } from '../queries/records';

export const Route = createFileRoute('/records/$id')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(recordQueryOptions(params.id)),
  errorComponent: RecordRouteError,
  component: RecordRoute,
});

function RecordRouteError({ error, reset }: ErrorComponentProps) {
  return <WorkspaceResourceError resource="record" error={error} retry={reset} />;
}

function RecordRoute() {
  const { id } = Route.useParams();
  const { data: record, error, refetch } = useRecord(id);
  if (error) {
    return (
      <WorkspaceResourceError
        resource="record"
        error={error}
        retry={() => {
          void refetch();
        }}
      />
    );
  }
  if (!record) {
    return null;
  }

  return (
    <DetailShell className="gap-0">
      <DetailHeader>
        <ResourceDetailHeading
          actions={null}
          context={<Badge variant="secondary">Synced by {record.sync.name}</Badge>}
        >
          Record
        </ResourceDetailHeading>
        <h1 className="font-semibold text-3xl tracking-tight md:text-4xl">{record.title}</h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{record.provider}</Badge>
          <Badge variant="outline">{record.kind}</Badge>
        </div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Source created</dt>
            <dd>
              <RecordTimestamp value={record.sourceCreatedAt} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Source updated</dt>
            <dd>
              <RecordTimestamp value={record.sourceUpdatedAt} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">First received</dt>
            <dd>
              <RecordTimestamp value={record.createdAt} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last received</dt>
            <dd>
              <RecordTimestamp value={record.updatedAt} />
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Source ID</dt>
            <dd className="break-all font-mono text-xs">{record.recordId}</dd>
          </div>
        </dl>
      </DetailHeader>
      <ExternalRecordMarkdown markdown={record.markdown} label={record.title} />
    </DetailShell>
  );
}
