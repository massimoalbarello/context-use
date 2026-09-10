import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
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
  removeHypermediaResourceSelection,
  selectedHypermediaResources,
  selectedHypermediaResourcesValue,
  toggleHypermediaResourceSelection,
} from '../components/hypermedia/hypermedia-selection';
import { HypermediaSidebar } from '../components/hypermedia/hypermedia-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import {
  type CalendarMonth,
  calendarMonth,
  calendarMonthFromRange,
  calendarMonthRange,
  currentCalendarMonth,
  mapMonthAfterScroll,
} from '../lib/calendar-month';
import { entitiesQueryOptions } from '../queries/entities';
import {
  type HypermediaPage,
  type HypermediaResourceReference,
  type HypermediaView,
  hypermediaPagesQueryOptions,
  hypermediaResourceKey,
  hypermediaResourceNeighborhoodQueryOptions,
} from '../queries/hypermedia';

const MAX_HYPERMEDIA_SEARCH_LENGTH = 160;
const MAX_HYPERMEDIA_READABLE_ID_LENGTH = 120;
const EMPTY_HYPERMEDIA_PAGES: HypermediaPage[] = [];
export type HypermediaSearch = {
  q?: string;
  view?: 'timeline';
  month?: CalendarMonth;
  kind?: HypermediaSelection['kind'];
  id?: string;
  focus?: string;
  show?: HypermediaResourceDisplay;
};

export function hypermediaSearch(search: Record<string, unknown>): HypermediaSearch {
  const result: HypermediaSearch = {};
  if (typeof search.q === 'string' && search.q.trim()) {
    result.q = search.q.trim().slice(0, MAX_HYPERMEDIA_SEARCH_LENGTH);
  }
  if (search.view === 'timeline') {
    result.view = 'timeline';
  }
  const selectedMonth = calendarMonth(search.month);
  if (selectedMonth) {
    result.month = selectedMonth;
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

export function hypermediaView(search: HypermediaSearch): HypermediaView {
  return search.view === 'timeline' ? 'timeline' : 'map';
}

export function hypermediaActiveMonth({
  search,
  now = new Date(),
}: {
  search: HypermediaSearch;
  now?: Date;
}): CalendarMonth | undefined {
  return (
    search.month ?? (hypermediaView(search) === 'timeline' ? currentCalendarMonth(now) : undefined)
  );
}

export function hypermediaSearchAfterEscape({
  previous,
  selection,
}: {
  previous: HypermediaSearch;
  selection: HypermediaSelection;
}): HypermediaSearch {
  const resources = removeHypermediaResourceSelection({
    resources: selectedHypermediaResources(previous.focus),
    selection,
  });
  return {
    ...previous,
    kind: undefined,
    id: undefined,
    focus: selectedHypermediaResourcesValue(resources),
  };
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
    month: hypermediaActiveMonth({ search }),
    resources: selectedHypermediaResources(search.focus),
    kinds: displayedHypermediaResourceKinds(search.show),
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
        hypermediaResourceNeighborhoodQueryOptions({ anchor: self, kinds: deps.kinds }),
      ),
      deps.kinds.includes('entity')
        ? context.queryClient.ensureInfiniteQueryData(entitiesQueryOptions())
        : Promise.resolve(),
      context.queryClient.ensureInfiniteQueryData(
        hypermediaPagesQueryOptions({
          interval: deps.month ? 'with' : 'without',
          resources: deps.resources,
          visibleResources: [],
          kinds: deps.kinds,
          month: deps.month,
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
  const view = hypermediaView(search);
  const activeMonth = hypermediaActiveMonth({ search });
  const resourceKinds = displayedHypermediaResourceKinds(show);
  const dateRange = activeMonth ? calendarMonthRange(activeMonth) : undefined;
  const navigate = Route.useNavigate();
  const [visibleResources, setVisibleResources] = useState<HypermediaResourceReference[]>([]);
  const selection: HypermediaSelection | undefined =
    kind && id ? { kind, readableId: id } : undefined;
  const selectedResources = selectedHypermediaResources(focus);
  const pageQuery = useInfiniteQuery({
    ...hypermediaPagesQueryOptions({
      interval: activeMonth ? 'with' : 'without',
      resources: selectedResources,
      visibleResources,
      kinds: resourceKinds,
      month: activeMonth,
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
        view={view}
        month={activeMonth}
        temporalExtent={pageQuery.data?.pages[0]?.temporalExtent ?? null}
        resourceKinds={resourceKinds}
        query={q}
        selectedResources={selectedResources}
        onViewChange={(nextView) => {
          void navigate({
            search: (previous) => ({
              ...previous,
              view: nextView === 'timeline' ? 'timeline' : undefined,
              month:
                nextView === 'timeline'
                  ? (calendarMonth(previous.month) ?? currentCalendarMonth())
                  : calendarMonth(previous.month),
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
            key={resourceKinds.join(':')}
            view={view}
            resourceKinds={resourceKinds}
            selfReadableId={profile.selfEntity.readableId}
            selection={selection}
            selectedResources={selectedResources}
            query={q}
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
              if (!nextRange) {
                return;
              }
              void navigate({
                search: (previous) => ({
                  ...previous,
                  month: calendarMonthFromRange(nextRange),
                  kind: previous.kind === 'page' ? undefined : previous.kind,
                  id: previous.kind === 'page' ? undefined : previous.id,
                }),
                replace: true,
              });
            }}
            onTimeNavigate={(direction) => {
              void navigate({
                search: (previous) => ({
                  ...previous,
                  month: mapMonthAfterScroll({
                    month: calendarMonth(previous.month),
                    direction,
                  }),
                  kind: previous.kind === 'page' ? undefined : previous.kind,
                  id: previous.kind === 'page' ? undefined : previous.id,
                }),
                replace: true,
              });
            }}
            onVisibleResourcesChange={(nextResources) => {
              setVisibleResources((current) => {
                const currentKeys = current.map(hypermediaResourceKey);
                const nextKeys = nextResources.map(hypermediaResourceKey);
                return currentKeys.length === nextKeys.length &&
                  currentKeys.join('\u0000') === nextKeys.join('\u0000')
                  ? current
                  : nextResources;
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
              onEscape={() => {
                void navigate({
                  search: (previous) => hypermediaSearchAfterEscape({ previous, selection }),
                });
              }}
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
