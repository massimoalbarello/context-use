import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import type { HypermediaSelection } from '../components/hypermedia/hypermedia-canvas';
import { HypermediaExplorer } from '../components/hypermedia/hypermedia-explorer';
import { HypermediaPreviewPanel } from '../components/hypermedia/hypermedia-preview-panel';
import {
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
  type HypermediaResourceReference,
  hypermediaPagesQueryOptions,
  hypermediaResourceKey,
  hypermediaResourceNeighborhoodQueryOptions,
} from '../queries/hypermedia';

const MAX_HYPERMEDIA_SEARCH_LENGTH = 160;
const MAX_HYPERMEDIA_READABLE_ID_LENGTH = 120;
const EMPTY_HYPERMEDIA_PAGES: HypermediaPage[] = [];
type HypermediaSearch = Partial<CalendarDateRange> & {
  q?: string;
  kind?: HypermediaSelection['kind'];
  id?: string;
  focus?: string;
};

function hypermediaSearch(search: Record<string, unknown>): HypermediaSearch {
  const result: HypermediaSearch = calendarDateRangeFromSearch(search) ?? {};
  if (typeof search.q === 'string' && search.q.trim()) {
    result.q = search.q.trim().slice(0, MAX_HYPERMEDIA_SEARCH_LENGTH);
  }
  if (
    (search.kind === 'page' || search.kind === 'entity' || search.kind === 'asset') &&
    typeof search.id === 'string' &&
    search.id.trim()
  ) {
    result.kind = search.kind;
    result.id = search.id.trim().slice(0, MAX_HYPERMEDIA_READABLE_ID_LENGTH);
  }
  result.focus = selectedHypermediaResourcesValue(selectedHypermediaResources(search.focus));
  return result;
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
    dateRange: calendarDateRangeFromSearch(search),
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
      context.queryClient.ensureQueryData(
        hypermediaPagesQueryOptions({
          resources: deps.resources,
          query: deps.query,
          dateRange: deps.dateRange,
        }),
      ),
    ]);
  },
  component: HypermediaRoute,
});

function HypermediaRoute() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const { q = '', kind, id, focus } = search;
  const dateRange = calendarDateRangeFromSearch(search);
  const navigate = Route.useNavigate();
  const selection: HypermediaSelection | undefined =
    kind && id ? { kind, readableId: id } : undefined;
  const selectedResources = selectedHypermediaResources(focus);
  const pageQuery = useQuery({
    ...hypermediaPagesQueryOptions({
      resources: selectedResources,
      query: q,
      dateRange,
    }),
    placeholderData: keepPreviousData,
    enabled: Boolean(profile),
  });
  if (!profile) {
    return null;
  }
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
        query={q}
        dateRange={dateRange}
        temporalExtent={pageQuery.data?.temporalExtent ?? null}
        hasMorePages={pageQuery.data?.hasMore ?? false}
        pagesLoading={pageQuery.isFetching}
        pagesError={pageQuery.error}
        selectedResources={selectedResources}
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
        onDateRangeApply={(nextRange) => {
          void navigate({
            search: (previous) => ({
              ...previous,
              from: nextRange?.from,
              to: nextRange?.to,
            }),
            replace: true,
          });
        }}
        onRetryPages={() => void pageQuery.refetch()}
      />
      <KnowledgeWorkspaceDetail>
        <div className="relative size-full">
          <HypermediaExplorer
            selfReadableId={profile.selfEntity.readableId}
            selection={selection}
            selectedResources={selectedResources}
            pages={pageQuery.data?.pages ?? EMPTY_HYPERMEDIA_PAGES}
            onSelect={selectKnowledge}
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
