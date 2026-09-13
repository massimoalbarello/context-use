import { createFileRoute, redirect } from '@tanstack/react-router';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import { recordListFilters, recordsAreFiltered } from '../lib/record-filters';
import { recordsQueryOptions } from '../queries/records';

export const Route = createFileRoute('/records/')({
  loaderDeps: ({ search }) => ({ search, filters: recordListFilters(search) }),
  loader: async ({ context, deps }) => {
    const records = await context.queryClient.ensureInfiniteQueryData(
      recordsQueryOptions(deps.filters),
    );
    const firstRecord = records.pages[0]?.items[0];
    if (firstRecord) {
      throw redirect({
        to: '/records/$id',
        params: { id: firstRecord.readableId },
        search: deps.search,
      });
    }
  },
  component: RecordsIndexRoute,
});

function RecordsIndexRoute() {
  if (recordsAreFiltered(Route.useSearch())) {
    return (
      <WorkspaceEmpty
        eyebrow="Records"
        title="No records match these filters"
        description="Clear or change the filters in the sidebar."
      />
    );
  }
  return (
    <WorkspaceEmpty
      eyebrow="Records"
      title="No synced records yet"
      description="Records appear here after an authorized sync delivers them."
    />
  );
}
