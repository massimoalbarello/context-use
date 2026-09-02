import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { KnowledgePageList } from '../components/pages/knowledge-page-list';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
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
  const [from, setFrom] = useState(dateRange?.from ?? '');
  const [to, setTo] = useState(dateRange?.to ?? '');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mb-2 grid gap-2 rounded-xl bg-muted/55 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          if (Boolean(from) !== Boolean(to)) {
            throw new Error('Choose both a start and end date.');
          }
          const nextRange = from && to ? { from, to } : undefined;
          if (nextRange) {
            calendarDateRangeExpression(nextRange);
          }
          setError(null);
          void navigate({
            to: '/pages',
            search: { from: nextRange?.from, to: nextRange?.to },
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Choose a valid date range.');
        }
      }}
    >
      <p className="font-medium text-xs">Date range</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-muted-foreground text-xs" htmlFor="page-time-from">
          From
          <Input
            id="page-time-from"
            type="date"
            max={to || undefined}
            value={from}
            aria-describedby="page-time-filter-help"
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setFrom(event.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="grid gap-1 text-muted-foreground text-xs" htmlFor="page-time-to">
          To
          <Input
            id="page-time-to"
            type="date"
            min={from || undefined}
            value={to}
            aria-describedby="page-time-filter-help"
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setTo(event.target.value);
              setError(null);
            }}
          />
        </label>
      </div>
      <p className="text-muted-foreground text-xs" id="page-time-filter-help">
        General knowledge stays visible.
      </p>
      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button className="h-7 px-2.5 text-xs" type="submit" size="sm">
          Apply
        </Button>
        {dateRange && (
          <Button
            className="h-7 px-2.5 text-xs"
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setFrom('');
              setTo('');
              setError(null);
              void navigate({ to: '/pages', search: {} });
            }}
          >
            Clear
          </Button>
        )}
      </div>
    </form>
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
        <PageTimeFilter
          key={dateRange ? `${dateRange.from}/${dateRange.to}` : ''}
          dateRange={dateRange}
        />
        <KnowledgePageList pages={pages} filtered={Boolean(dateRange)} />
      </KnowledgeSidebar>
      <KnowledgeWorkspaceDetail>
        <Outlet />
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
