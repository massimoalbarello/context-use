import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useContext, useState } from 'react';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { ResourceBrowser } from '../components/knowledge/resource-browser';
import { ResourceNavigation } from '../components/knowledge/resource-navigation';
import { MapExplorer } from '../components/map/map-explorer';
import type { MapSelection } from '../components/map/map-selection';
import { type CalendarMonth, calendarMonth } from '../lib/calendar-month';
import { type ResourceSearch, resourceSearch } from '../lib/resource-selection';
import { entitiesQueryOptions } from '../queries/entities';
import {
  type MapEntityReference,
  type MapPage,
  mapEntityKey,
  mapNeighborhoodsQueryOptions,
  mapPagesQueryOptions,
  mergeMapPages,
} from '../queries/map';

const EMPTY_MAP_PAGES: MapPage[] = [];
export type MapSearch = ResourceSearch & {
  month?: CalendarMonth;
};

export function mapSearch(search: Record<string, unknown>): MapSearch {
  const result: MapSearch = resourceSearch(search);
  const selectedMonth = calendarMonth(search.month);
  if (selectedMonth) {
    result.month = selectedMonth;
  }
  return result;
}

export const Route = createFileRoute('/app/map')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/app/login', search: { redirect: location.href } });
    }
  },
  validateSearch: mapSearch,
  loader: async ({ context }) => {
    if (!context.profile) {
      return;
    }
    const self: MapEntityReference = {
      readableId: context.profile.selfEntity.readableId,
    };
    await Promise.all([
      context.queryClient.ensureQueryData(mapNeighborhoodsQueryOptions([{ anchor: self }])),
      context.queryClient.ensureInfiniteQueryData(entitiesQueryOptions()),
    ]);
  },
  component: MapRoute,
});

function MapContent() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const { month } = search;
  const navigation = useContext(ResourceNavigation);
  const navigate = Route.useNavigate();
  const [visibleEntities, setVisibleEntities] = useState<MapEntityReference[]>([]);
  const selection = navigation?.selection;
  const pageQuery = useInfiniteQuery({
    ...mapPagesQueryOptions({
      visibleEntities,
      month,
    }),
    enabled: Boolean(profile),
  });
  if (!profile) {
    return null;
  }
  const loadedPages = pageQuery.data ? mergeMapPages(pageQuery.data.pages) : EMPTY_MAP_PAGES;
  const pageReferencesTruncated =
    pageQuery.data?.pages.some(({ entityReferencesTruncated }) => entityReferencesTruncated) ??
    false;
  function selectKnowledge(nextSelection: MapSelection) {
    navigation?.onSelect(nextSelection);
  }

  return (
    <div className="relative size-full">
      <MapExplorer
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
              ...mapSearch(previous),
              month: nextMonth,
              resource: previous.resource === 'page' ? undefined : previous.resource,
              resourceId: previous.resource === 'page' ? undefined : previous.resourceId,
            }),
            replace: true,
          });
        }}
        onVisibleEntitiesChange={(nextEntities) => {
          setVisibleEntities((current) => {
            const currentKeys = current.map(mapEntityKey);
            const nextKeys = nextEntities.map(mapEntityKey);
            return currentKeys.length === nextKeys.length &&
              currentKeys.join('\u0000') === nextKeys.join('\u0000')
              ? current
              : nextEntities;
          });
        }}
        onRetryPages={() => {
          void (pageQuery.isFetchNextPageError ? pageQuery.fetchNextPage() : pageQuery.refetch());
        }}
        onDiscoverMorePages={() => {
          void pageQuery.fetchNextPage({ cancelRefetch: false });
        }}
      />
    </div>
  );
}

function MapRoute() {
  const { profile } = Route.useRouteContext();
  if (!profile) {
    return null;
  }
  return (
    <KnowledgeWorkspace>
      <KnowledgeSidebar profile={profile} />
      <KnowledgeWorkspaceDetail>
        <ResourceBrowser from="/app/map">
          <MapContent />
        </ResourceBrowser>
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
