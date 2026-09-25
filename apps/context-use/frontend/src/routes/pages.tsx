import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  type KnowledgePageIntervalFilter,
  MAX_KNOWLEDGE_PAGE_TITLE_LENGTH,
} from '#backend/models/knowledge-pages/model.ts';
import type { PublicationVisibility } from '#backend/models/publications/model.ts';
import { CollectionWorkspace } from '../components/knowledge/collection-workspace';
import { KeywordFilter } from '../components/knowledge/keyword-filter';
import { KnowledgePageList } from '../components/pages/knowledge-page-list';
import { PageFilters } from '../components/pages/page-filters';
import { PublicationVisibilityFilter } from '../components/publications/publication-visibility-filter';
import { usePages } from '../lib/hooks/use-pages';
import { publicationVisibilityFromSearch } from '../lib/publication-visibility';
import { type ResourceSearch, resourceSearch } from '../lib/resource-selection';
import { type CalendarDateRange, calendarDateRangeFromSearch } from '../lib/temporal-coverage';
import { type KnowledgePageListFilters, pagesQueryOptions } from '../queries/pages';

export type PageSearch = Partial<CalendarDateRange> & {
  q?: string;
  interval?: KnowledgePageIntervalFilter;
  visibility?: PublicationVisibility;
};

export function pageSearch(search: Record<string, unknown>): PageSearch {
  const result: PageSearch = calendarDateRangeFromSearch(search) ?? {};
  if (typeof search.q === 'string' && search.q.trim()) {
    result.q = search.q.trim().slice(0, MAX_KNOWLEDGE_PAGE_TITLE_LENGTH);
  }
  if (search.interval === 'with' || search.interval === 'without') {
    result.interval = search.interval;
  }
  result.visibility = publicationVisibilityFromSearch(search.visibility);
  return result;
}

export function pageListFilters(search: PageSearch): KnowledgePageListFilters {
  return {
    dateRange: calendarDateRangeFromSearch(search),
    query: search.q,
    interval: search.interval,
    visibility: search.visibility,
  };
}

export const Route = createFileRoute('/pages')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: (search: Record<string, unknown>): PageSearch & ResourceSearch => ({
    ...pageSearch(search),
    ...resourceSearch(search),
  }),
  loaderDeps: ({ search }) => ({ filters: pageListFilters(search) }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(pagesQueryOptions(deps.filters)),
  component: PagesLayout,
});

function PageFilterControl({ search }: { search: PageSearch }) {
  const navigate = Route.useNavigate();
  const { interval } = search;
  const dateRange = calendarDateRangeFromSearch(search);

  return (
    <PageFilters
      interval={interval}
      dateRange={dateRange}
      onIntervalChange={(nextInterval) => {
        void navigate({
          to: '/pages',
          search: (previous) => ({
            ...previous,
            interval: nextInterval,
            from: nextInterval === 'without' ? undefined : previous.from,
            to: nextInterval === 'without' ? undefined : previous.to,
          }),
          replace: true,
        });
      }}
      onDateRangeApply={(nextRange) => {
        void navigate({
          to: '/pages',
          search: (previous) => ({ ...previous, from: nextRange?.from, to: nextRange?.to }),
          replace: true,
        });
      }}
    />
  );
}

function PagesLayout() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filters = pageListFilters(search);
  const { pages, total, error, hasNextPage, isFetchingNextPage, fetchNextPage } = usePages(filters);
  if (!profile) {
    return null;
  }

  return (
    <CollectionWorkspace
      collection="pages"
      title="Pages"
      search={
        <KeywordFilter
          inputId="page-keyword"
          value={search.q ?? ''}
          placeholder="Search pages"
          maxLength={MAX_KNOWLEDGE_PAGE_TITLE_LENGTH}
          onApply={(query) => {
            void navigate({
              to: '/pages',
              search: { ...search, q: query || undefined },
              replace: true,
            });
          }}
        />
      }
      visibleFilters={
        <PublicationVisibilityFilter
          value={search.visibility}
          onChange={(visibility) => {
            void navigate({
              to: '/pages',
              search: (previous) => ({ ...previous, visibility }),
              replace: true,
            });
          }}
        />
      }
      count={total}
      createTo="/pages/new"
      createLabel="New page"
      profile={profile}
      error={error}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      loadMore={fetchNextPage}
      filters={<PageFilterControl search={search} />}
    >
      <KnowledgePageList
        pages={pages}
        filtered={Boolean(
          filters.dateRange || filters.query || filters.interval || filters.visibility,
        )}
      />
    </CollectionWorkspace>
  );
}
