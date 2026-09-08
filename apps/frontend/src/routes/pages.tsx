import { type KnowledgePageKind, MAX_KNOWLEDGE_PAGE_TITLE_LENGTH } from '@repo/backend/page';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { KnowledgePageList } from '../components/pages/knowledge-page-list';
import { PageFilters } from '../components/pages/page-filters';
import { usePages } from '../lib/hooks/use-pages';
import { type CalendarDateRange, calendarDateRangeFromSearch } from '../lib/temporal-coverage';
import { type KnowledgePageListFilters, pagesQueryOptions } from '../queries/pages';

export type PageSearch = Partial<CalendarDateRange> & {
  q?: string;
  pageType?: KnowledgePageKind;
};

export function pageSearch(search: Record<string, unknown>): PageSearch {
  const result: PageSearch = calendarDateRangeFromSearch(search) ?? {};
  if (typeof search.q === 'string' && search.q.trim()) {
    result.q = search.q.trim().slice(0, MAX_KNOWLEDGE_PAGE_TITLE_LENGTH);
  }
  if (search.pageType === 'semantic' || search.pageType === 'temporal') {
    result.pageType = search.pageType;
  }
  return result;
}

export function pageListFilters(search: PageSearch): KnowledgePageListFilters {
  return {
    dateRange: calendarDateRangeFromSearch(search),
    query: search.q,
    kind: search.pageType,
  };
}

export const Route = createFileRoute('/pages')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: pageSearch,
  loaderDeps: ({ search }) => ({ filters: pageListFilters(search) }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(pagesQueryOptions(deps.filters)),
  component: PagesLayout,
});

function PageFilterControl({ search }: { search: PageSearch }) {
  const navigate = Route.useNavigate();
  const { q = '', pageType } = search;
  const dateRange = calendarDateRangeFromSearch(search);
  const commonSearch = {
    q: search.q,
    pageType,
    from: dateRange?.from,
    to: dateRange?.to,
  };

  return (
    <PageFilters
      query={q}
      kind={pageType}
      dateRange={dateRange}
      onQueryApply={(query) => {
        void navigate({
          to: '/pages',
          search: { ...commonSearch, q: query || undefined },
          replace: true,
        });
      }}
      onKindChange={(nextKind) => {
        void navigate({
          to: '/pages',
          search: {
            ...commonSearch,
            pageType: nextKind,
            from: nextKind === 'semantic' ? undefined : commonSearch.from,
            to: nextKind === 'semantic' ? undefined : commonSearch.to,
          },
          replace: true,
        });
      }}
      onDateRangeApply={(nextRange) => {
        void navigate({
          to: '/pages',
          search: { ...commonSearch, from: nextRange?.from, to: nextRange?.to },
          replace: true,
        });
      }}
    />
  );
}

function PagesLayout() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const filters = pageListFilters(search);
  const { pages, total, error, hasNextPage, isFetchingNextPage, fetchNextPage } = usePages(filters);
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
        actions={<PageFilterControl search={search} />}
      >
        <KnowledgePageList
          pages={pages}
          filtered={Boolean(filters.dateRange || filters.query || filters.kind)}
        />
      </KnowledgeSidebar>
      <KnowledgeWorkspaceDetail>
        <Outlet />
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
