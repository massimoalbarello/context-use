import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { HypermediaExplorer } from '../components/hypermedia/hypermedia-explorer';
import { HypermediaPreviewPanel } from '../components/hypermedia/hypermedia-preview-panel';
import {
  displayedHypermediaResourceKinds,
  displayedHypermediaResourceKindsValue,
  type HypermediaResourceDisplay,
  toggleDisplayedHypermediaResourceKind,
} from '../components/hypermedia/hypermedia-resource-filter';
import {
  type HypermediaSelection,
  selectedHypermediaResources,
  selectedHypermediaResourcesValue,
  toggleHypermediaResourceSelection,
} from '../components/hypermedia/hypermedia-selection';
import { HypermediaSidebar } from '../components/hypermedia/hypermedia-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { type CalendarDateRange, calendarDateRangeFromSearch } from '../lib/temporal-coverage';
import { entitiesQueryOptions } from '../queries/entities';
import {
  type HypermediaPage,
  type HypermediaPageProjection,
  type HypermediaResourceReference,
  hypermediaPagesQueryOptions,
  hypermediaResourceKey,
  hypermediaResourceNeighborhoodQueryOptions,
} from '../queries/hypermedia';

const MAX_HYPERMEDIA_SEARCH_LENGTH = 160;
const MAX_HYPERMEDIA_READABLE_ID_LENGTH = 120;
const EMPTY_HYPERMEDIA_PAGES: HypermediaPage[] = [];
export type HypermediaSearch = Partial<CalendarDateRange> & {
  q?: string;
  view?: 'temporal';
  kind?: HypermediaSelection['kind'];
  id?: string;
  focus?: string;
  show?: HypermediaResourceDisplay;
};

export function hypermediaSearchWithDateRange({
  previous,
  nextRange,
}: {
  previous: HypermediaSearch;
  nextRange?: CalendarDateRange;
}): HypermediaSearch {
  return {
    ...previous,
    from: nextRange?.from,
    to: nextRange?.to,
  };
}

export function hypermediaSearch(search: Record<string, unknown>): HypermediaSearch {
  const result: HypermediaSearch = calendarDateRangeFromSearch(search) ?? {};
  if (typeof search.q === 'string' && search.q.trim()) {
    result.q = search.q.trim().slice(0, MAX_HYPERMEDIA_SEARCH_LENGTH);
  }
  if (search.view === 'temporal') {
    result.view = 'temporal';
  }
  if (search.show === 'assets' || search.show === 'all') {
    result.show = search.show;
  }
  const selectionKind =
    search.kind === 'page' || search.kind === 'entity' || search.kind === 'asset'
      ? search.kind
      : undefined;
  const selectionIsVisible =
    selectionKind === 'page' ||
    (selectionKind !== undefined &&
      displayedHypermediaResourceKinds(result.show).includes(selectionKind));
  if (selectionKind && selectionIsVisible && typeof search.id === 'string' && search.id.trim()) {
    result.kind = selectionKind;
    result.id = search.id.trim().slice(0, MAX_HYPERMEDIA_READABLE_ID_LENGTH);
  }
  result.focus = selectedHypermediaResourcesValue(selectedHypermediaResources(search.focus));
  return result;
}

export function hypermediaProjection(search: HypermediaSearch): HypermediaPageProjection {
  return search.view ?? 'semantic';
}

export const Route = createFileRoute('/hypermedia')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: hypermediaSearch,
  loaderDeps: ({ search }) => ({
    query: search.q,
    projection: hypermediaProjection(search),
    resources: selectedHypermediaResources(search.focus),
  }),
  loader: async ({ context, deps }) => {
    if (!context.profile) {
      return;
    }
    const self: HypermediaResourceReference = {
      kind: 'entity',
      readableId: context.profile.selfEntity.readableId,
    };
    await Promise.all([
      context.queryClient.ensureQueryData(
        hypermediaResourceNeighborhoodQueryOptions({ anchor: self }),
      ),
      context.queryClient.ensureInfiniteQueryData(entitiesQueryOptions),
      context.queryClient.ensureInfiniteQueryData(
        hypermediaPagesQueryOptions({
          projection: deps.projection,
          resources: deps.resources,
          query: deps.query,
        }),
      ),
    ]);
  },
  component: HypermediaRoute,
});

function HypermediaRoute() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const { q = '', kind, id, focus, show } = search;
  const projection = hypermediaProjection(search);
  const resourceKinds = displayedHypermediaResourceKinds(show);
  const dateRange = calendarDateRangeFromSearch(search);
  const navigate = Route.useNavigate();
  const selection: HypermediaSelection | undefined =
    kind && id ? { kind, readableId: id } : undefined;
  const selectedResources = selectedHypermediaResources(focus);
  const pageQuery = useInfiniteQuery({
    ...hypermediaPagesQueryOptions({
      projection,
      resources: selectedResources,
      query: q,
    }),
    enabled: Boolean(profile),
  });
  if (!profile) {
    return null;
  }
  const loadedPages =
    pageQuery.data?.pages.flatMap(({ pages: pageItems }) => pageItems) ?? EMPTY_HYPERMEDIA_PAGES;
  const pageReferencesTruncated =
    pageQuery.data?.pages.some(({ resourceReferencesTruncated }) => resourceReferencesTruncated) ??
    false;
  function selectKnowledge(nextSelection: HypermediaSelection) {
    void navigate({
      search: (previous) => {
        const previousResources = selectedHypermediaResources(previous.focus);
        const wasSelected =
          nextSelection.kind !== 'page' &&
          previousResources.some(
            (resource) =>
              hypermediaResourceKey(resource) ===
              `${nextSelection.kind}:${nextSelection.readableId}`,
          );
        const resources = toggleHypermediaResourceSelection({
          resources: previousResources,
          selection: nextSelection,
        });
        return {
          ...previous,
          kind: wasSelected ? undefined : nextSelection.kind,
          id: wasSelected ? undefined : nextSelection.readableId,
          focus: selectedHypermediaResourcesValue(resources),
        };
      },
    });
  }
  function clearSelectedResources() {
    void navigate({
      search: (previous) => ({
        ...previous,
        kind: undefined,
        id: undefined,
        focus: undefined,
      }),
    });
  }

  return (
    <KnowledgeWorkspace>
      <HypermediaSidebar
        profile={profile}
        projection={projection}
        resourceKinds={resourceKinds}
        query={q}
        selectedResources={selectedResources}
        onProjectionChange={(nextProjection) => {
          void navigate({
            search: (previous) => ({
              ...previous,
              view: nextProjection === 'temporal' ? 'temporal' : undefined,
            }),
            replace: true,
          });
        }}
        onResourceKindToggle={(kind) => {
          void navigate({
            search: (previous) => {
              const nextKinds = toggleDisplayedHypermediaResourceKind({
                kinds: displayedHypermediaResourceKinds(previous.show),
                kind,
              });
              const previewRemainsVisible =
                previous.kind === undefined ||
                previous.kind === 'page' ||
                nextKinds.includes(previous.kind);
              return {
                ...previous,
                show: displayedHypermediaResourceKindsValue(nextKinds),
                kind: previewRemainsVisible ? previous.kind : undefined,
                id: previewRemainsVisible ? previous.id : undefined,
              };
            },
            replace: true,
          });
        }}
        onClearSelectedResources={clearSelectedResources}
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
      />
      <KnowledgeWorkspaceDetail>
        <div className="relative size-full">
          <HypermediaExplorer
            projection={projection}
            resourceKinds={resourceKinds}
            selfReadableId={profile.selfEntity.readableId}
            selection={selection}
            selectedResources={selectedResources}
            pages={loadedPages}
            temporalExtent={pageQuery.data?.pages[0]?.temporalExtent ?? null}
            dateRange={dateRange}
            pagesLoading={pageQuery.isFetching}
            pagesError={pageQuery.error}
            hasNextPage={pageQuery.hasNextPage}
            pageReferencesTruncated={pageReferencesTruncated}
            isFetchingNextPage={pageQuery.isFetchingNextPage}
            onSelect={selectKnowledge}
            onDateRangeApply={(nextRange) => {
              void navigate({
                search: (previous) => hypermediaSearchWithDateRange({ previous, nextRange }),
                replace: true,
              });
            }}
            onRetryPages={() => {
              void (pageQuery.isFetchNextPageError
                ? pageQuery.fetchNextPage()
                : pageQuery.refetch());
            }}
            onDiscoverMorePages={() => void pageQuery.fetchNextPage()}
          />
          {selection && (
            <HypermediaPreviewPanel
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
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
