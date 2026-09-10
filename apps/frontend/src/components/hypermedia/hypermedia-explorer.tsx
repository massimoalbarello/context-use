import { useQueries } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarMonth } from '../../lib/calendar-month';
import { useEntities } from '../../lib/hooks/use-entities';
import {
  type HypermediaPage,
  type HypermediaPages,
  type HypermediaResourceReference,
  type HypermediaView,
  hypermediaResourceKey,
  hypermediaResourceNeighborhoodQueryOptions,
} from '../../queries/hypermedia';
import { Button } from '../ui/button';
import { HypermediaCanvas } from './hypermedia-canvas';
import { buildStableResources } from './hypermedia-layout';
import { filterHypermedia, type HypermediaResourceKind } from './hypermedia-resource-filter';
import { type HypermediaSelection, hypermediaSelectionKey } from './hypermedia-selection';
import { HypermediaTimelineCanvas } from './hypermedia-temporal-canvas';
import type { SettledHypermediaViewport } from './hypermedia-visibility';

type NeighborhoodRequest = {
  anchor: HypermediaResourceReference;
  cursor?: string;
};

function requestKey(request: NeighborhoodRequest): string {
  return `${hypermediaResourceKey(request.anchor)}:${request.cursor ?? 'first'}`;
}

function appendNeighborhoodRequest({
  current,
  request,
}: {
  current: NeighborhoodRequest[];
  request: NeighborhoodRequest;
}): NeighborhoodRequest[] {
  return current.some((candidate) => requestKey(candidate) === requestKey(request))
    ? current
    : [...current, request];
}

function neighborhoodRequestsForResources({
  resources,
  initial = [],
}: {
  resources: HypermediaResourceReference[];
  initial?: NeighborhoodRequest[];
}): NeighborhoodRequest[] {
  let requests = initial;
  for (const anchor of resources) {
    requests = appendNeighborhoodRequest({ current: requests, request: { anchor } });
  }
  return requests;
}

function resourceSelection(
  selection?: HypermediaSelection,
): HypermediaResourceReference | undefined {
  return selection && selection.kind !== 'page'
    ? { kind: selection.kind, readableId: selection.readableId }
    : undefined;
}

export function HypermediaExplorer({
  view,
  resourceKinds,
  selfReadableId,
  selection,
  selectedResources,
  query,
  pages,
  month,
  temporalExtent,
  pagesLoading,
  pagesTransitioning,
  pagesError,
  hasNextPage,
  pageReferencesTruncated,
  isFetchingNextPage,
  onSelect,
  onMonthChange,
  onVisibleResourcesChange,
  onRetryPages,
  onDiscoverMorePages,
}: {
  view: HypermediaView;
  resourceKinds: HypermediaResourceKind[];
  selfReadableId: string;
  selection?: HypermediaSelection;
  selectedResources: HypermediaResourceReference[];
  query: string;
  pages: HypermediaPage[];
  month?: CalendarMonth;
  temporalExtent: HypermediaPages['temporalExtent'];
  pagesLoading: boolean;
  pagesTransitioning: boolean;
  pagesError: Error | null;
  hasNextPage: boolean;
  pageReferencesTruncated: boolean;
  isFetchingNextPage: boolean;
  onSelect: (selection: HypermediaSelection) => void;
  onMonthChange: (month?: CalendarMonth) => void;
  onVisibleResourcesChange: (resources: HypermediaResourceReference[]) => void;
  onRetryPages: () => void;
  onDiscoverMorePages: () => void;
}) {
  const self = useMemo<HypermediaResourceReference>(
    () => ({ kind: 'entity', readableId: selfReadableId }),
    [selfReadableId],
  );
  const selectedResource = useMemo(() => resourceSelection(selection), [selection]);
  const selectedNeighborhoodResources = useMemo(
    () => (selectedResource ? [...selectedResources, selectedResource] : selectedResources),
    [selectedResource, selectedResources],
  );
  const [exploredNeighborhoodRequests, setExploredNeighborhoodRequests] = useState<
    NeighborhoodRequest[]
  >(() =>
    neighborhoodRequestsForResources({ resources: [self, ...selectedNeighborhoodResources] }),
  );
  const neighborhoodRequests = useMemo(
    () =>
      neighborhoodRequestsForResources({
        resources: selectedNeighborhoodResources,
        initial: exploredNeighborhoodRequests,
      }),
    [exploredNeighborhoodRequests, selectedNeighborhoodResources],
  );
  const neighborhoodQueries = useQueries({
    queries: neighborhoodRequests.map((request) =>
      hypermediaResourceNeighborhoodQueryOptions({ ...request, kinds: resourceKinds }),
    ),
  });
  const neighborhoods = useMemo(
    () => neighborhoodQueries.flatMap(({ data }) => (data ? [data] : [])),
    [neighborhoodQueries],
  );
  const {
    data: entityData,
    error: entityError,
    hasNextPage: hasNextEntityPage,
    isFetchingNextPage: isFetchingNextEntityPage,
    isPending: entitiesPending,
    fetchNextPage: fetchNextEntityPage,
    refetch: refetchEntities,
  } = useEntities({ enabled: resourceKinds.includes('entity') });
  const entities = useMemo(
    () =>
      resourceKinds.includes('entity')
        ? (entityData?.pages.flatMap((page) => page.items) ?? [])
        : [],
    [entityData, resourceKinds],
  );
  const [resources, setResources] = useState(() => buildStableResources([], []));
  const [intervalScrolling, setIntervalScrolling] = useState(false);

  const visualizedHypermedia = useMemo(
    () => filterHypermedia({ resources, pages, kinds: resourceKinds, query }),
    [pages, query, resourceKinds, resources],
  );
  const visualizedSelectedResources = useMemo(() => {
    const normalizedQuery = query.trim();
    const visibleResourceKeys = new Set([
      ...visualizedHypermedia.resources.map(({ key }) => key),
      ...visualizedHypermedia.pages.flatMap(({ resources: references }) =>
        references.map(hypermediaResourceKey),
      ),
    ]);
    return selectedResources.filter(
      (resource) =>
        resourceKinds.includes(resource.kind) &&
        (!normalizedQuery || visibleResourceKeys.has(hypermediaResourceKey(resource))),
    );
  }, [query, resourceKinds, selectedResources, visualizedHypermedia]);

  useEffect(() => {
    setResources((current) => buildStableResources(neighborhoods, entities, current));
  }, [entities, neighborhoods]);

  const handleViewportSettled = useCallback(
    ({ focus, discoverMoreEntities, boundaryAnchor }: SettledHypermediaViewport) => {
      onVisibleResourcesChange(focus);
      if (
        resourceKinds.includes('entity') &&
        discoverMoreEntities &&
        hasNextEntityPage &&
        !isFetchingNextEntityPage
      ) {
        void fetchNextEntityPage();
      }
      if (!boundaryAnchor || neighborhoodQueries.some(({ isPending }) => isPending)) {
        return;
      }
      const candidates = [
        boundaryAnchor,
        ...focus.filter(
          (resource) => hypermediaResourceKey(resource) !== hypermediaResourceKey(boundaryAnchor),
        ),
      ];
      const anchor = candidates.find((candidate) => {
        const key = hypermediaResourceKey(candidate);
        const matchingRequests = neighborhoodRequests.filter(
          (request) => hypermediaResourceKey(request.anchor) === key,
        );
        const lastRequest = matchingRequests.at(-1);
        const result = lastRequest
          ? neighborhoodQueries[neighborhoodRequests.indexOf(lastRequest)]
          : undefined;
        return matchingRequests.length === 0 || Boolean(result?.data?.nextCursor);
      });
      if (!anchor) {
        return;
      }
      const anchorKey = hypermediaResourceKey(anchor);
      const matching = neighborhoodRequests.flatMap((request) =>
        hypermediaResourceKey(request.anchor) === anchorKey
          ? [{ request, result: neighborhoodQueries[neighborhoodRequests.indexOf(request)] }]
          : [],
      );
      const next: NeighborhoodRequest = {
        anchor,
        cursor: matching.at(-1)?.result?.data?.nextCursor ?? undefined,
      };
      setExploredNeighborhoodRequests((current) =>
        appendNeighborhoodRequest({ current, request: next }),
      );
    },
    [
      fetchNextEntityPage,
      hasNextEntityPage,
      isFetchingNextEntityPage,
      neighborhoodQueries,
      neighborhoodRequests,
      onVisibleResourcesChange,
      resourceKinds,
    ],
  );

  const handleSelect = useCallback(
    (nextSelection: HypermediaSelection) => {
      const resource = resourceSelection(nextSelection);
      if (resource) {
        setExploredNeighborhoodRequests((current) =>
          appendNeighborhoodRequest({ current, request: { anchor: resource } }),
        );
      }
      onSelect(nextSelection);
    },
    [onSelect],
  );

  const neighborhoodError =
    neighborhoodQueries.find(({ error }) => error)?.error ??
    (resourceKinds.includes('entity') ? entityError : null);
  const selectedKey = selection ? hypermediaSelectionKey(selection) : undefined;
  const requestedAnchorKeys = new Set(
    neighborhoodRequests.map(({ anchor }) => hypermediaResourceKey(anchor)),
  );
  const canExplore =
    (resourceKinds.includes('entity') && hasNextEntityPage) ||
    neighborhoodQueries.some(({ data }) => Boolean(data?.nextCursor)) ||
    visualizedHypermedia.resources.some(({ key }) => !requestedAnchorKeys.has(key));
  return (
    <div className="relative size-full min-h-[28rem]">
      {view === 'map' ? (
        <HypermediaCanvas
          key={query.trim().toLocaleLowerCase()}
          resources={visualizedHypermedia.resources}
          pages={visualizedHypermedia.pages}
          month={month}
          selectedResources={visualizedSelectedResources}
          selectedKey={selectedKey}
          onSelect={handleSelect}
          onViewportSettled={handleViewportSettled}
          onMonthChange={onMonthChange}
          onIntervalScrollingChange={setIntervalScrolling}
          canExplore={canExplore}
          isInitialLoading={
            visualizedHypermedia.resources.length === 0 &&
            ((resourceKinds.includes('entity') && entitiesPending) ||
              neighborhoodQueries.some(({ isPending }) => isPending))
          }
          neighborhoodError={neighborhoodError}
          onRetryNeighborhood={() => {
            if (resourceKinds.includes('entity') && entityError) {
              void refetchEntities();
            }
            for (const result of neighborhoodQueries) {
              if (result.error) {
                void result.refetch();
              }
            }
          }}
        />
      ) : (
        <HypermediaTimelineCanvas
          key={query.trim().toLocaleLowerCase()}
          resources={visualizedHypermedia.resources}
          pages={visualizedHypermedia.pages}
          extent={temporalExtent}
          month={month}
          selectedResources={visualizedSelectedResources}
          selectedKey={selectedKey}
          onSelect={handleSelect}
          onMonthChange={onMonthChange}
          onIntervalScrollingChange={setIntervalScrolling}
          onViewportSettled={handleViewportSettled}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onDiscoverMorePages={onDiscoverMorePages}
        />
      )}
      <HypermediaPageStatus
        view={view}
        pageCount={pages.length}
        loading={pagesLoading}
        suppressed={intervalScrolling || pagesTransitioning}
        error={pagesError}
        hasNextPage={hasNextPage}
        referencesTruncated={pageReferencesTruncated}
        onRetry={onRetryPages}
        onLoadMore={onDiscoverMorePages}
      />
    </div>
  );
}

export function HypermediaPageStatus({
  view,
  pageCount,
  loading,
  suppressed,
  error,
  hasNextPage,
  referencesTruncated,
  onRetry,
  onLoadMore,
}: {
  view: HypermediaView;
  pageCount: number;
  loading: boolean;
  suppressed: boolean;
  error: Error | null;
  hasNextPage: boolean;
  referencesTruncated: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  const canLoadMore = view === 'map' && hasNextPage;
  if (!loading && !error && pageCount > 0 && !canLoadMore && !referencesTruncated) {
    return null;
  }
  let message: string | undefined;
  if (error) {
    message = 'Couldn’t load pages.';
  } else if (loading) {
    message = 'Loading pages…';
  } else if (pageCount === 0) {
    message = 'No pages match this interval.';
  } else if (canLoadMore && referencesTruncated) {
    message = 'More pages are available, and some page connections are hidden.';
  } else if (canLoadMore) {
    message = 'More pages are available.';
  } else if (referencesTruncated) {
    message = 'Some page connections are hidden.';
  }
  if (!message) {
    return null;
  }
  return (
    <div
      className="absolute right-4 bottom-4 z-20 flex items-center gap-2 rounded-full border bg-card/92 px-3 py-2 text-muted-foreground text-xs shadow-sm backdrop-blur"
      role={error ? 'alert' : 'status'}
      hidden={suppressed}
    >
      {loading && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
      <span>{message}</span>
      {error && (
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={onRetry}>
          Try again
        </Button>
      )}
      {!loading && !error && canLoadMore && (
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={onLoadMore}>
          Load more pages
        </Button>
      )}
    </div>
  );
}
