import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { KnowledgePageList } from '../components/pages/knowledge-page-list';
import { PageDateRangeFilter } from '../components/pages/page-date-range-filter';
import { usePages } from '../lib/hooks/use-pages';
import { type CalendarDateRange, calendarDateRangeExpression } from '../lib/temporal-coverage';
import { pagesQueryOptions } from '../queries/pages';

function pageSearch(search: Record<string, unknown>): Partial<CalendarDateRange> {
  if (typeof search.from !== 'string' || typeof search.to !== 'string') {
    return {};
  }
  calendarDateRangeExpression({ from: search.from, to: search.to });
  return { from: search.from, to: search.to };
}

function dateRangeFrom(search: Partial<CalendarDateRange>): CalendarDateRange | undefined {
  return search.from && search.to ? { from: search.from, to: search.to } : undefined;
}

export const Route = createFileRoute('/pages')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: pageSearch,
  loaderDeps: ({ search }) => ({ dateRange: dateRangeFrom(search) }),
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
        if (nextRange) {
          calendarDateRangeExpression(nextRange);
        }
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
  const dateRange = dateRangeFrom(search);
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
