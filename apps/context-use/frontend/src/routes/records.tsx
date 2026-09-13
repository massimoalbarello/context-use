import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { RecordFilters } from '../components/records/record-filters';
import { RecordList } from '../components/records/record-list';
import { useRecords } from '../lib/hooks/use-records';
import { recordListFilters, recordSearch, recordsAreFiltered } from '../lib/record-filters';
import { recordsQueryOptions } from '../queries/records';

export const Route = createFileRoute('/records')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: recordSearch,
  loaderDeps: ({ search }) => ({ filters: recordListFilters(search) }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(recordsQueryOptions(deps.filters)),
  component: RecordsLayout,
});

function RecordsLayout() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { records, filterOptions, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useRecords(recordListFilters(search));
  if (!profile) {
    return null;
  }

  return (
    <KnowledgeWorkspace>
      <KnowledgeSidebar
        collection="records"
        count={records.length}
        profile={profile}
        error={error}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMore={fetchNextPage}
        actions={
          <RecordFilters
            search={search}
            options={filterOptions}
            onChange={(next) => {
              void navigate({ to: '/records', search: next, replace: true });
            }}
          />
        }
      >
        <RecordList records={records} filtered={recordsAreFiltered(search)} />
      </KnowledgeSidebar>
      <KnowledgeWorkspaceDetail>
        <Outlet />
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
