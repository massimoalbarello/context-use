import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { DetailHeader, DetailShell } from '../components/knowledge/detail-shell';
import { ResourceDetailHeading } from '../components/knowledge/resource-detail-heading';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { ExternalRecordMarkdown } from '../components/records/external-record-markdown';
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
      </DetailHeader>
      <ExternalRecordMarkdown markdown={record.markdown} label={record.title} />
    </DetailShell>
  );
}
