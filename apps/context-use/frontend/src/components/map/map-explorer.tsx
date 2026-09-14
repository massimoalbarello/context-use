import { Button } from '@repo/ui/button';
import { useQueries } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarMonth } from '../../lib/calendar-month';
import { useEntities } from '../../lib/hooks/use-entities';
import type { ResourceSelection } from '../../lib/resource-selection';
import {
  type MapEntityReference,
  type MapNeighborhoodRequest,
  type MapPage,
  mapEntityKey,
  mapNeighborhoodsQueryOptions,
} from '../../queries/map';
import { MapCanvas } from './map-canvas';
import {
  appendNeighborhoodRequests,
  MAP_EXPANSION_BATCH_SIZE,
  mergeMapNeighborhoods,
} from './map-graph-data';
import { buildStableEntities } from './map-layout';
import { type MapSelection, mapSelectionKey } from './map-selection';
import type { SettledMapViewport } from './map-visibility';

export function MapExplorer({
  selfReadableId,
  selection,
  pages,
  month,
  pagesLoading,
  pagesTransitioning,
  pagesError,
  hasNextPage,
  pageReferencesTruncated,
  onSelect,
  onMonthChange,
  onVisibleEntitiesChange,
  onRetryPages,
  onDiscoverMorePages,
}: {
  selfReadableId: string;
  selection?: ResourceSelection;
  pages: MapPage[];
  month?: CalendarMonth;
  pagesLoading: boolean;
  pagesTransitioning: boolean;
  pagesError: Error | null;
  hasNextPage: boolean;
  pageReferencesTruncated: boolean;
  onSelect: (selection: MapSelection) => void;
  onMonthChange: (month?: CalendarMonth) => void;
  onVisibleEntitiesChange: (entities: MapEntityReference[]) => void;
  onRetryPages: () => void;
  onDiscoverMorePages: () => void;
}) {
  const [neighborhoodRequests, setNeighborhoodRequests] = useState<MapNeighborhoodRequest[][]>(
    () => [[{ anchor: { readableId: selfReadableId } }]],
  );
  const neighborhoodQueries = useQueries({
    queries: neighborhoodRequests.map(mapNeighborhoodsQueryOptions),
  });
  const neighborhoods = useMemo(
    () => mergeMapNeighborhoods(neighborhoodQueries.flatMap(({ data }) => (data ? [data] : []))),
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
  } = useEntities();
  const listedEntities = useMemo(
    () => entityData?.pages.flatMap((page) => page.items) ?? [],
    [entityData],
  );
  const [entities, setEntities] = useState(() => buildStableEntities([], []));
  const [intervalScrolling, setIntervalScrolling] = useState(false);

  useEffect(() => {
    setEntities((current) => buildStableEntities(neighborhoods, listedEntities, current));
  }, [listedEntities, neighborhoods]);

  const handleViewportSettled = useCallback(
    ({ focus, discoverMoreEntities, boundaryAnchor }: SettledMapViewport) => {
      onVisibleEntitiesChange(focus);
      if (discoverMoreEntities && hasNextEntityPage && !isFetchingNextEntityPage) {
        void fetchNextEntityPage();
      }
      if (!boundaryAnchor || neighborhoodQueries.some(({ isPending }) => isPending)) {
        return;
      }
      const candidates = [
        boundaryAnchor,
        ...focus.filter((entity) => mapEntityKey(entity) !== mapEntityKey(boundaryAnchor)),
      ];
      const next = candidates
        .flatMap((anchor) => {
          const key = mapEntityKey(anchor);
          const lastBatchIndex = neighborhoodRequests.findLastIndex((batch) =>
            batch.some((request) => mapEntityKey(request.anchor) === key),
          );
          if (lastBatchIndex === -1) {
            return [{ anchor }];
          }
          const result = neighborhoodQueries[lastBatchIndex]?.data?.neighborhoods.find(
            (neighborhood) => mapEntityKey(neighborhood.anchor) === key,
          );
          return result?.nextCursor ? [{ anchor, cursor: result.nextCursor }] : [];
        })
        .slice(0, MAP_EXPANSION_BATCH_SIZE);
      setNeighborhoodRequests((current) => appendNeighborhoodRequests({ current, requests: next }));
    },
    [
      fetchNextEntityPage,
      hasNextEntityPage,
      isFetchingNextEntityPage,
      neighborhoodQueries,
      neighborhoodRequests,
      onVisibleEntitiesChange,
    ],
  );

  const neighborhoodError = neighborhoodQueries.find(({ error }) => error)?.error ?? entityError;
  const selectedKey = selection ? mapSelectionKey(selection) : undefined;
  const requestedAnchorKeys = new Set(
    neighborhoodRequests.flat().map(({ anchor }) => mapEntityKey(anchor)),
  );
  const latestNeighborhoods = new Map(
    neighborhoodQueries.flatMap(
      ({ data }) =>
        data?.neighborhoods.map(
          (neighborhood) => [mapEntityKey(neighborhood.anchor), neighborhood] as const,
        ) ?? [],
    ),
  );
  const canExplore =
    hasNextEntityPage ||
    [...latestNeighborhoods.values()].some(({ nextCursor }) => Boolean(nextCursor)) ||
    entities.some(({ key }) => !requestedAnchorKeys.has(key));
  return (
    <div className="relative size-full min-h-[28rem]">
      <MapCanvas
        entities={entities}
        pages={pages}
        month={month}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onViewportSettled={handleViewportSettled}
        onMonthChange={onMonthChange}
        onIntervalScrollingChange={setIntervalScrolling}
        canExplore={canExplore}
        isInitialLoading={
          entities.length === 0 &&
          (entitiesPending || neighborhoodQueries.some(({ isPending }) => isPending))
        }
        neighborhoodError={neighborhoodError}
        onRetryNeighborhood={() => {
          if (entityError) {
            void refetchEntities();
          }
          for (const result of neighborhoodQueries) {
            if (result.error) {
              void result.refetch();
            }
          }
        }}
      />
      <MapPageStatus
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

export function MapPageStatus({
  pageCount,
  loading,
  suppressed,
  error,
  hasNextPage,
  referencesTruncated,
  onRetry,
  onLoadMore,
}: {
  pageCount: number;
  loading: boolean;
  suppressed: boolean;
  error: Error | null;
  hasNextPage: boolean;
  referencesTruncated: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  if (!loading && !error && pageCount > 0 && !hasNextPage && !referencesTruncated) {
    return null;
  }
  let message: string | undefined;
  if (error) {
    message = 'Couldn’t load pages.';
  } else if (loading) {
    message = 'Loading pages…';
  } else if (pageCount === 0) {
    message = 'No pages match this interval.';
  } else if (hasNextPage && referencesTruncated) {
    message = 'More pages are available, and some page connections are hidden.';
  } else if (hasNextPage) {
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
      {!loading && !error && hasNextPage && (
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={onLoadMore}>
          Load more pages
        </Button>
      )}
    </div>
  );
}
