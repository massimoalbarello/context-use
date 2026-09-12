import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useContext, useState } from 'react';
import { HypermediaExplorer } from '../components/hypermedia/hypermedia-explorer';
import type { HypermediaSelection } from '../components/hypermedia/hypermedia-selection';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { ResourceBrowser } from '../components/knowledge/resource-browser';
import { ResourceNavigation } from '../components/knowledge/resource-navigation';
import { type CalendarMonth, calendarMonth } from '../lib/calendar-month';
import { type ResourceSearch, resourceSearch } from '../lib/resource-selection';
import { entitiesQueryOptions } from '../queries/entities';
import {
  type HypermediaEntityReference,
  type HypermediaPage,
  hypermediaEntityKey,
  hypermediaNeighborhoodsQueryOptions,
  hypermediaPagesQueryOptions,
  mergeHypermediaPages,
} from '../queries/hypermedia';

const EMPTY_HYPERMEDIA_PAGES: HypermediaPage[] = [];
export type HypermediaSearch = ResourceSearch & {
  month?: CalendarMonth;
};

export function hypermediaSearch(search: Record<string, unknown>): HypermediaSearch {
  const result: HypermediaSearch = resourceSearch(search);
  const selectedMonth = calendarMonth(search.month);
  if (selectedMonth) {
    result.month = selectedMonth;
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
      context.queryClient.ensureQueryData(hypermediaNeighborhoodsQueryOptions([{ anchor: self }])),
      context.queryClient.ensureInfiniteQueryData(entitiesQueryOptions()),
    ]);
  },
  component: HypermediaRoute,
});

function HypermediaContent() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const { month } = search;
  const navigation = useContext(ResourceNavigation);
  const navigate = Route.useNavigate();
  const [visibleEntities, setVisibleEntities] = useState<HypermediaEntityReference[]>([]);
  const selection = navigation?.selection;
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
  const loadedPages = pageQuery.data
    ? mergeHypermediaPages(pageQuery.data.pages)
    : EMPTY_HYPERMEDIA_PAGES;
  const pageReferencesTruncated =
    pageQuery.data?.pages.some(({ entityReferencesTruncated }) => entityReferencesTruncated) ??
    false;
  function selectKnowledge(nextSelection: HypermediaSelection) {
    navigation?.onSelect(nextSelection);
  }

  return (
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
              resource: previous.resource === 'page' ? undefined : previous.resource,
              resourceId: previous.resource === 'page' ? undefined : previous.resourceId,
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
          void (pageQuery.isFetchNextPageError ? pageQuery.fetchNextPage() : pageQuery.refetch());
        }}
        onDiscoverMorePages={() => {
          void pageQuery.fetchNextPage({ cancelRefetch: false });
        }}
      />
    </div>
  );
}

function HypermediaRoute() {
  const { profile } = Route.useRouteContext();
  if (!profile) {
    return null;
  }
  return (
    <KnowledgeWorkspace>
      <KnowledgeSidebar profile={profile} />
      <KnowledgeWorkspaceDetail>
        <ResourceBrowser from="/hypermedia">
          <HypermediaContent />
        </ResourceBrowser>
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
