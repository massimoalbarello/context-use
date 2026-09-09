import { createFileRoute, redirect } from '@tanstack/react-router';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import { recordsQueryOptions } from '../queries/records';

export const Route = createFileRoute('/records/')({
  loader: async ({ context }) => {
    const records = await context.queryClient.ensureInfiniteQueryData(recordsQueryOptions());
    const firstRecord = records.pages[0]?.items[0];
    if (firstRecord) {
      throw redirect({ to: '/records/$id', params: { id: firstRecord.readableId } });
    }
  },
  component: RecordsIndexRoute,
});

function RecordsIndexRoute() {
  return (
    <WorkspaceEmpty
      eyebrow="Records"
      title="No synced records yet"
      description="Records appear here after an external service is connected and delivers them."
    />
  );
}
