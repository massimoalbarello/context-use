import {
  MAX_TEMPORAL_COVERAGE_LENGTH,
  parseTemporalCoverage,
} from '@repo/backend/temporal-coverage';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { KnowledgePageList } from '../components/pages/knowledge-page-list';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { usePages } from '../lib/hooks/use-pages';
import { pagesQueryOptions } from '../queries/pages';

function pageSearch(search: Record<string, unknown>): { time?: string } {
  if (typeof search.time !== 'string' || !search.time) {
    return {};
  }
  parseTemporalCoverage(search.time);
  return { time: search.time };
}

export const Route = createFileRoute('/pages')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: pageSearch,
  loaderDeps: ({ search }) => ({ time: search.time }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(pagesQueryOptions(deps.time)),
  component: PagesLayout,
});

function PageTimeFilter({ time }: { time?: string }) {
  const navigate = Route.useNavigate();
  const [draft, setDraft] = useState(time ?? '');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mb-2 grid gap-2 rounded-xl bg-muted/55 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const normalized = draft.trim();
        try {
          if (normalized) {
            parseTemporalCoverage(normalized);
          }
          setError(null);
          void navigate({ to: '/pages', search: { time: normalized || undefined } });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Enter a supported subject time.');
        }
      }}
    >
      <label className="font-medium text-xs" htmlFor="page-time-filter">
        Filter by subject time
      </label>
      <Input
        id="page-time-filter"
        maxLength={MAX_TEMPORAL_COVERAGE_LENGTH}
        placeholder="2025 or 2025-03/2025-08"
        value={draft}
        aria-describedby="page-time-filter-help"
        aria-invalid={Boolean(error)}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
      />
      <p className="text-muted-foreground text-xs" id="page-time-filter-help">
        Matches overlapping dates or ranges.
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
        {time && (
          <Button
            className="h-7 px-2.5 text-xs"
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft('');
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
  const { time } = Route.useSearch();
  const { pages, total, error, hasNextPage, isFetchingNextPage, fetchNextPage } = usePages(time);
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
        <PageTimeFilter key={time ?? ''} time={time} />
        <KnowledgePageList pages={pages} time={time} />
      </KnowledgeSidebar>
      <KnowledgeWorkspaceDetail>
        <Outlet />
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
