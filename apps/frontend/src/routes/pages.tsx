import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { KnowledgePageList } from '../components/pages/knowledge-page-list';
import { PageDateRangeFilter } from '../components/pages/page-date-range-filter';
import { usePages } from '../lib/hooks/use-pages';
import { type CalendarDateRange, calendarDateRangeFromSearch } from '../lib/temporal-coverage';
import { pagesQueryOptions } from '../queries/pages';

function pageSearch(search: Record<string, unknown>): Partial<CalendarDateRange> {
  return calendarDateRangeFromSearch(search) ?? {};
}

export const Route = createFileRoute('/pages')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: pageSearch,
  loaderDeps: ({ search }) => ({ dateRange: calendarDateRangeFromSearch(search) }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(pagesQueryOptions(deps.dateRange)),
  component: PagesLayout,
});

function PageTimeFilter({ dateRange }: { dateRange?: CalendarDateRange }) {
  const navigate = Route.useNavigate();

  return (
    <PageDateRangeFilter
      value={dateRange}
      onApply={(nextRange) => {
        void navigate({
          to: '/pages',
          search: { from: nextRange?.from, to: nextRange?.to },
        });
      }}
    />
  );
}

function PagesLayout() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const dateRange = calendarDateRangeFromSearch(search);
  const { pages, total, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    usePages(dateRange);
  if (!profile) {
    return null;
  }

  return (
    <KnowledgeWorkspace>
      <KnowledgeSidebar
        collection="pages"
        count={total}
        createTo="/pages/new"
        createLabel="New page"
        profile={profile}
        error={error}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMore={fetchNextPage}
      >
        <PageTimeFilter dateRange={dateRange} />
        <KnowledgePageList pages={pages} filtered={Boolean(dateRange)} />
      </KnowledgeSidebar>
      <KnowledgeWorkspaceDetail>
        <Outlet />
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
