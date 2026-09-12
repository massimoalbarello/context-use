import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { HypermediaExplorer } from '../components/hypermedia/hypermedia-explorer';
import { HypermediaPreviewPanel } from '../components/hypermedia/hypermedia-preview-panel';
import {
  type HypermediaSelection,
  removeHypermediaEntitySelection,
  selectedHypermediaEntities,
  selectedHypermediaEntitiesValue,
  toggleHypermediaEntitySelection,
} from '../components/hypermedia/hypermedia-selection';
import { HypermediaSidebar } from '../components/hypermedia/hypermedia-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { type CalendarMonth, calendarMonth } from '../lib/calendar-month';
import { entitiesQueryOptions } from '../queries/entities';
import {
  type HypermediaEntity,
  type HypermediaEntityReference,
  type HypermediaPage,
  hypermediaEntityKey,
  hypermediaEntityNeighborhoodQueryOptions,
  hypermediaPagesQueryOptions,
} from '../queries/hypermedia';

const MAX_HYPERMEDIA_SEARCH_LENGTH = 160;
const MAX_HYPERMEDIA_READABLE_ID_LENGTH = 120;
const EMPTY_HYPERMEDIA_PAGES: HypermediaPage[] = [];
const EMPTY_HYPERMEDIA_ENTITIES: HypermediaEntity[] = [];
export type HypermediaSearch = {
  q?: string;
  month?: CalendarMonth;
  kind?: HypermediaSelection['kind'];
  id?: string;
  focus?: string;
};

export function hypermediaSearch(search: Record<string, unknown>): HypermediaSearch {
  const result: HypermediaSearch = {};
  if (typeof search.q === 'string' && search.q.trim()) {
    result.q = search.q.trim().slice(0, MAX_HYPERMEDIA_SEARCH_LENGTH);
  }
  const selectedMonth = calendarMonth(search.month);
  if (selectedMonth) {
    result.month = selectedMonth;
  }
  const selectionKind =
    search.kind === 'page' || search.kind === 'entity' ? search.kind : undefined;
  if (selectionKind && typeof search.id === 'string' && search.id.trim()) {
    result.kind = selectionKind;
    result.id = search.id.trim().slice(0, MAX_HYPERMEDIA_READABLE_ID_LENGTH);
  }
  result.focus = selectedHypermediaEntitiesValue(selectedHypermediaEntities(search.focus));
  return result;
}

export function hypermediaSearchAfterEscape({
  previous,
  selection,
}: {
  previous: HypermediaSearch;
  selection: HypermediaSelection;
}): HypermediaSearch {
  const entities = removeHypermediaEntitySelection({
    entities: selectedHypermediaEntities(previous.focus),
    selection,
  });
  return {
    ...previous,
    kind: undefined,
    id: undefined,
    focus: selectedHypermediaEntitiesValue(entities),
  };
}

export const Route = createFileRoute('/hypermedia')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: hypermediaSearch,
  loader: async ({ context }) => {
    if (!context.profile) {
      return;
    }
    const self: HypermediaEntityReference = {
      readableId: context.profile.selfEntity.readableId,
    };
    await Promise.all([
      context.queryClient.ensureQueryData(
        hypermediaEntityNeighborhoodQueryOptions({ anchor: self }),
      ),
      context.queryClient.ensureInfiniteQueryData(entitiesQueryOptions()),
    ]);
  },
  component: HypermediaRoute,
});

function HypermediaRoute() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const { q = '', kind, id, focus, month } = search;
  const navigate = Route.useNavigate();
  const [visibleEntities, setVisibleEntities] = useState<HypermediaEntityReference[]>([]);
  const selection: HypermediaSelection | undefined =
    kind && id ? { kind, readableId: id } : undefined;
  const selectedEntities = selectedHypermediaEntities(focus);
  const pageQuery = useInfiniteQuery({
    ...hypermediaPagesQueryOptions({
      entities: selectedEntities,
      visibleEntities,
      month,
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
    pageQuery.data?.pages.some(({ entityReferencesTruncated }) => entityReferencesTruncated) ??
    false;
  function selectKnowledge(nextSelection: HypermediaSelection) {
    void navigate({
      search: (previous) => {
        const previousEntities = selectedHypermediaEntities(previous.focus);
        const wasSelected =
          nextSelection.kind !== 'page' &&
          previousEntities.some(
            (entity) =>
              hypermediaEntityKey(entity) === `${nextSelection.kind}:${nextSelection.readableId}`,
          );
        const entities = toggleHypermediaEntitySelection({
          entities: previousEntities,
          selection: nextSelection,
        });
        return {
          ...previous,
          kind: wasSelected ? undefined : nextSelection.kind,
          id: wasSelected ? undefined : nextSelection.readableId,
          focus: selectedHypermediaEntitiesValue(entities),
        };
      },
    });
  }
  function clearSelectedEntities() {
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
        selectedEntities={selectedEntities}
        onClearSelectedEntities={clearSelectedEntities}
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
            selfReadableId={profile.selfEntity.readableId}
            selection={selection}
            selectedEntities={selectedEntities}
            query={q}
            pages={loadedPages}
            matchedEntities={
              pageQuery.data?.pages[0]?.matchedEntities ??
              (q.trim() ? EMPTY_HYPERMEDIA_ENTITIES : null)
            }
            month={month}
            pagesLoading={pageQuery.isFetching}
            pagesTransitioning={pageQuery.isPlaceholderData}
            pagesError={pageQuery.error}
            hasNextPage={pageQuery.hasNextPage}
            pageReferencesTruncated={pageReferencesTruncated}
            onSelect={selectKnowledge}
            onMonthChange={(nextMonth) => {
              void navigate({
                search: (previous) => ({
                  ...previous,
                  month: nextMonth,
                  kind: previous.kind === 'page' ? undefined : previous.kind,
                  id: previous.kind === 'page' ? undefined : previous.id,
                }),
                replace: true,
              });
            }}
            onVisibleEntitiesChange={(nextEntities) => {
              setVisibleEntities((current) => {
                const currentKeys = current.map(hypermediaEntityKey);
                const nextKeys = nextEntities.map(hypermediaEntityKey);
                return currentKeys.length === nextKeys.length &&
                  currentKeys.join('\u0000') === nextKeys.join('\u0000')
                  ? current
                  : nextEntities;
              });
            }}
            onRetryPages={() => {
              void (pageQuery.isFetchNextPageError
                ? pageQuery.fetchNextPage()
                : pageQuery.refetch());
            }}
            onDiscoverMorePages={() => {
              void pageQuery.fetchNextPage({ cancelRefetch: false });
            }}
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
