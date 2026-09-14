import { createFileRoute, redirect } from '@tanstack/react-router';
import { MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH } from '#backend/models/hypermedia-retrieval/model.ts';
import { CollectionWorkspace } from '../components/knowledge/collection-workspace';
import { KeywordFilter } from '../components/knowledge/keyword-filter';
import { RecordFilters } from '../components/records/record-filters';
import { RecordList } from '../components/records/record-list';
import { useRecords } from '../lib/hooks/use-records';
import {
  type RecordSearch,
  recordListFilters,
  recordSearch,
  recordsAreFiltered,
} from '../lib/record-filters';
import { type ResourceSearch, resourceSearch } from '../lib/resource-selection';
import { recordsQueryOptions } from '../queries/records';

export const Route = createFileRoute('/records')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: (search: Record<string, unknown>): RecordSearch & ResourceSearch => ({
    ...recordSearch(search),
    ...resourceSearch(search),
  }),
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
    <CollectionWorkspace
      collection="records"
      title="Records"
      search={
        <KeywordFilter
          key={search.q ?? ''}
          inputId="record-keyword"
          value={search.q ?? ''}
          placeholder="Search records"
          maxLength={MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH}
          onApply={(query) => {
            void navigate({
              to: '/records',
              search: { ...search, q: query || undefined },
              replace: true,
            });
          }}
        />
      }
      count={records.length}
      countLabel={`${records.length}${hasNextPage ? '+' : ''}`}
      profile={profile}
      error={error}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      loadMore={fetchNextPage}
      filters={
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
    </CollectionWorkspace>
  );
}
