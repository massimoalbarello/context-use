import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { HypermediaExplorer } from '../components/hypermedia/hypermedia-explorer';
import { HypermediaPreviewPanel } from '../components/hypermedia/hypermedia-preview-panel';
import type { HypermediaSelection } from '../components/hypermedia/hypermedia-selection';
import { HypermediaSidebar } from '../components/hypermedia/hypermedia-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { type CalendarMonth, calendarMonth } from '../lib/calendar-month';
import { entitiesQueryOptions } from '../queries/entities';
import {
  type HypermediaEntityReference,
  type HypermediaPage,
  hypermediaEntityKey,
  hypermediaEntityNeighborhoodQueryOptions,
  hypermediaPagesQueryOptions,
} from '../queries/hypermedia';

const MAX_HYPERMEDIA_READABLE_ID_LENGTH = 120;
const EMPTY_HYPERMEDIA_PAGES: HypermediaPage[] = [];
export type HypermediaSearch = {
  month?: CalendarMonth;
  kind?: HypermediaSelection['kind'];
  id?: string;
};

export function hypermediaSearch(search: Record<string, unknown>): HypermediaSearch {
  const result: HypermediaSearch = {};
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
  return result;
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
  const { kind, id, month } = search;
  const navigate = Route.useNavigate();
  const [visibleEntities, setVisibleEntities] = useState<HypermediaEntityReference[]>([]);
  const selection: HypermediaSelection | undefined =
    kind && id ? { kind, readableId: id } : undefined;
  const pageQuery = useInfiniteQuery({
    ...hypermediaPagesQueryOptions({
      visibleEntities,
      month,
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
      search: (previous) => ({
        ...hypermediaSearch(previous),
        kind: nextSelection.kind,
        id: nextSelection.readableId,
      }),
    });
  }
  function closePreview() {
    void navigate({
      search: (previous) => ({
        ...hypermediaSearch(previous),
        kind: undefined,
        id: undefined,
      }),
    });
  }

  return (
    <KnowledgeWorkspace>
      <HypermediaSidebar profile={profile} />
      <KnowledgeWorkspaceDetail>
        <div className="relative size-full">
          <HypermediaExplorer
            selfReadableId={profile.selfEntity.readableId}
            selection={selection}
            pages={loadedPages}
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
                  ...hypermediaSearch(previous),
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
              onEscape={closePreview}
              onClose={closePreview}
            />
          )}
        </div>
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
