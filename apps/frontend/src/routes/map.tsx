import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMemo } from 'react';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import {
  KnowledgeMapCanvas,
  type KnowledgeMapSelection,
} from '../components/knowledge-map/knowledge-map-canvas';
import { KnowledgeMapPreviewPanel } from '../components/knowledge-map/knowledge-map-preview-panel';
import { KnowledgeMapSidebar } from '../components/knowledge-map/knowledge-map-sidebar';
import { type CalendarDateRange, calendarDateRangeFromSearch } from '../lib/temporal-coverage';
import { knowledgeMapFrom, knowledgeMapQueryOptions } from '../queries/knowledge-map';

const MAX_MAP_SEARCH_LENGTH = 160;
const MAX_MAP_READABLE_ID_LENGTH = 120;
type KnowledgeMapSearch = Partial<CalendarDateRange> & {
  q?: string;
  kind?: KnowledgeMapSelection['kind'];
  id?: string;
};

function mapSearch(search: Record<string, unknown>): KnowledgeMapSearch {
  const result: KnowledgeMapSearch = calendarDateRangeFromSearch(search) ?? {};
  if (typeof search.q === 'string' && search.q.trim()) {
    result.q = search.q.trim().slice(0, MAX_MAP_SEARCH_LENGTH);
  }
  if (
    (search.kind === 'page' || search.kind === 'entity' || search.kind === 'asset') &&
    typeof search.id === 'string' &&
    search.id.trim()
  ) {
    result.kind = search.kind;
    result.id = search.id.trim().slice(0, MAX_MAP_READABLE_ID_LENGTH);
  }
  return result;
}

export const Route = createFileRoute('/map')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: mapSearch,
  loaderDeps: ({ search }) => ({
    query: search.q,
    dateRange: calendarDateRangeFromSearch(search),
  }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(knowledgeMapQueryOptions(deps)),
  component: KnowledgeMapRoute,
});

function KnowledgeMapEmpty({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <div className="mx-auto flex min-h-[32rem] max-w-md flex-col justify-center px-6 text-center">
        <h2 className="font-semibold text-2xl tracking-tight">Nothing matches these filters</h2>
        <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
          Try another keyword or widen the interval.
        </p>
      </div>
    );
  }

  return (
    <WorkspaceEmpty
      eyebrow="Hypermedia map"
      title="Your map starts with a knowledge page"
      description="Create a knowledge page that mentions an entity or includes an asset. Its relationships will become the first neighborhood on this map."
      createTo="/pages/new"
      createLabel="Create the first knowledge page"
    />
  );
}

function KnowledgeMapRoute() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const { q = '', kind, id } = search;
  const dateRange = calendarDateRangeFromSearch(search);
  const mapQuery = useSuspenseInfiniteQuery(knowledgeMapQueryOptions({ query: q, dateRange }));
  const map = useMemo(() => knowledgeMapFrom(mapQuery.data.pages), [mapQuery.data.pages]);
  const navigate = Route.useNavigate();
  if (!profile) {
    return null;
  }
  const filtersActive = Boolean(q || dateRange);
  const selection = kind && id ? { kind, readableId: id } : undefined;
  function selectKnowledge(nextSelection: KnowledgeMapSelection) {
    void navigate({
      search: (previous) => ({
        ...previous,
        kind: nextSelection.kind,
        id: nextSelection.readableId,
      }),
    });
  }

  return (
    <KnowledgeWorkspace>
      <KnowledgeMapSidebar
        profile={profile}
        truncated={map.truncated}
        query={q}
        dateRange={dateRange}
        onQueryApply={(query) => {
          void navigate({
            search: (previous) => ({
              ...previous,
              q: query.trim() ? query : undefined,
              kind: undefined,
              id: undefined,
            }),
            replace: true,
          });
        }}
        onDateRangeApply={(nextRange) => {
          void navigate({
            search: (previous) => ({
              ...previous,
              from: nextRange?.from,
              to: nextRange?.to,
              kind: undefined,
              id: undefined,
            }),
            replace: true,
          });
        }}
      />
      <KnowledgeWorkspaceDetail>
        {map.pages.length === 0 ? (
          <KnowledgeMapEmpty filtered={filtersActive} />
        ) : (
          <div className="relative size-full">
            <KnowledgeMapCanvas
              key={`${q}:${dateRange?.from ?? ''}:${dateRange?.to ?? ''}`}
              pages={map.pages}
              anchorEntity={profile.selfEntity}
              selectedKey={selection ? `${selection.kind}:${selection.readableId}` : undefined}
              onSelect={selectKnowledge}
              hasNextPage={mapQuery.hasNextPage}
              isFetchingNextPage={mapQuery.isFetchingNextPage}
              loadMoreError={mapQuery.isFetchNextPageError ? mapQuery.error : null}
              onLoadMore={() => mapQuery.fetchNextPage()}
            />
            {selection && (
              <KnowledgeMapPreviewPanel
                selection={selection}
                onSelect={selectKnowledge}
                onClose={() => {
                  void navigate({
                    search: (previous) => ({
                      ...previous,
                      kind: undefined,
                      id: undefined,
                    }),
                  });
                }}
              />
            )}
          </div>
        )}
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
