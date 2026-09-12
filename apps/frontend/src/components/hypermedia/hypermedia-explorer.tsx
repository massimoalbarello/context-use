import { useQueries } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarMonth } from '../../lib/calendar-month';
import { useEntities } from '../../lib/hooks/use-entities';
import {
  type HypermediaEntityReference,
  type HypermediaNeighborhoodRequest,
  type HypermediaPage,
  type HypermediaPages,
  hypermediaEntityKey,
  hypermediaEntityReference,
  hypermediaNeighborhoodsQueryOptions,
} from '../../queries/hypermedia';
import { Button } from '../ui/button';
import { HypermediaCanvas } from './hypermedia-canvas';
import { filterHypermedia } from './hypermedia-entity-filter';
import {
  appendNeighborhoodRequests,
  HYPERMEDIA_EXPANSION_BATCH_SIZE,
  mergeHypermediaNeighborhoods,
} from './hypermedia-graph-data';
import { buildStableEntities } from './hypermedia-layout';
import { type HypermediaSelection, hypermediaSelectionKey } from './hypermedia-selection';
import type { SettledHypermediaViewport } from './hypermedia-visibility';

function entitySelection(selection?: HypermediaSelection): HypermediaEntityReference | undefined {
  return selection && selection.kind !== 'page' ? { readableId: selection.readableId } : undefined;
}

export function HypermediaExplorer({
  selfReadableId,
  selection,
  selectedEntities,
  query,
  pages,
  matchedEntities,
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
  selection?: HypermediaSelection;
  selectedEntities: HypermediaEntityReference[];
  query: string;
  pages: HypermediaPage[];
  matchedEntities: HypermediaPages['matchedEntities'];
  month?: CalendarMonth;
  pagesLoading: boolean;
  pagesTransitioning: boolean;
  pagesError: Error | null;
  hasNextPage: boolean;
  pageReferencesTruncated: boolean;
  onSelect: (selection: HypermediaSelection) => void;
  onMonthChange: (month?: CalendarMonth) => void;
  onVisibleEntitiesChange: (entities: HypermediaEntityReference[]) => void;
  onRetryPages: () => void;
  onDiscoverMorePages: () => void;
}) {
  const self = useMemo<HypermediaEntityReference>(
    () => ({ readableId: selfReadableId }),
    [selfReadableId],
  );
  const selectedEntity = useMemo(() => entitySelection(selection), [selection]);
  const selectedNeighborhoodEntities = useMemo(
    () => (selectedEntity ? [...selectedEntities, selectedEntity] : selectedEntities),
    [selectedEntity, selectedEntities],
  );
  const [exploredNeighborhoodRequests, setExploredNeighborhoodRequests] = useState<
    HypermediaNeighborhoodRequest[][]
  >(() =>
    appendNeighborhoodRequests({
      current: [],
      requests: [self, ...selectedNeighborhoodEntities].map((anchor) => ({ anchor })),
    }),
  );
  const neighborhoodRequests = useMemo(
    () =>
      appendNeighborhoodRequests({
        current: exploredNeighborhoodRequests,
        requests: selectedNeighborhoodEntities.map((anchor) => ({ anchor })),
      }),
    [exploredNeighborhoodRequests, selectedNeighborhoodEntities],
  );
  const neighborhoodQueries = useQueries({
    queries: neighborhoodRequests.map(hypermediaNeighborhoodsQueryOptions),
  });
  const neighborhoods = useMemo(
    () =>
      mergeHypermediaNeighborhoods(neighborhoodQueries.flatMap(({ data }) => (data ? [data] : []))),
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

  const visualizedHypermedia = useMemo(
    () =>
      filterHypermedia({
        entities,
        pages,
        matchingEntityKeys:
          matchedEntities === null
            ? undefined
            : new Set(
                matchedEntities.map((entity) =>
                  hypermediaEntityKey(hypermediaEntityReference(entity)),
                ),
              ),
      }),
    [pages, matchedEntities, entities],
  );
  const visualizedSelectedEntities = useMemo(() => {
    const normalizedQuery = query.trim();
    const visibleEntityKeys = new Set([
      ...visualizedHypermedia.entities.map(({ key }) => key),
      ...visualizedHypermedia.pages.flatMap(({ entities: references }) =>
        references.map(hypermediaEntityKey),
      ),
    ]);
    return selectedEntities.filter(
      (entity) => !normalizedQuery || visibleEntityKeys.has(hypermediaEntityKey(entity)),
    );
  }, [query, selectedEntities, visualizedHypermedia]);

  useEffect(() => {
    setEntities((current) =>
      buildStableEntities(neighborhoods, [...listedEntities, ...(matchedEntities ?? [])], current),
    );
  }, [listedEntities, matchedEntities, neighborhoods]);

  const handleViewportSettled = useCallback(
    ({ focus, discoverMoreEntities, boundaryAnchor }: SettledHypermediaViewport) => {
      onVisibleEntitiesChange(focus);
      if (discoverMoreEntities && hasNextEntityPage && !isFetchingNextEntityPage) {
        void fetchNextEntityPage();
      }
      if (!boundaryAnchor || neighborhoodQueries.some(({ isPending }) => isPending)) {
        return;
      }
      const candidates = [
        boundaryAnchor,
        ...focus.filter(
          (entity) => hypermediaEntityKey(entity) !== hypermediaEntityKey(boundaryAnchor),
        ),
      ];
      const next = candidates
        .flatMap((anchor) => {
          const key = hypermediaEntityKey(anchor);
          const lastBatchIndex = neighborhoodRequests.findLastIndex((batch) =>
            batch.some((request) => hypermediaEntityKey(request.anchor) === key),
          );
          if (lastBatchIndex === -1) {
            return [{ anchor }];
          }
          const result = neighborhoodQueries[lastBatchIndex]?.data?.neighborhoods.find(
            (neighborhood) => hypermediaEntityKey(neighborhood.anchor) === key,
          );
          return result?.nextCursor ? [{ anchor, cursor: result.nextCursor }] : [];
        })
        .slice(0, HYPERMEDIA_EXPANSION_BATCH_SIZE);
      setExploredNeighborhoodRequests((current) =>
        appendNeighborhoodRequests({ current, requests: next }),
      );
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

  const handleSelect = useCallback(
    (nextSelection: HypermediaSelection) => {
      const entity = entitySelection(nextSelection);
      if (entity) {
        setExploredNeighborhoodRequests((current) =>
          appendNeighborhoodRequests({ current, requests: [{ anchor: entity }] }),
        );
      }
      onSelect(nextSelection);
    },
    [onSelect],
  );

  const neighborhoodError = neighborhoodQueries.find(({ error }) => error)?.error ?? entityError;
  const selectedKey = selection ? hypermediaSelectionKey(selection) : undefined;
  const requestedAnchorKeys = new Set(
    neighborhoodRequests.flat().map(({ anchor }) => hypermediaEntityKey(anchor)),
  );
  const latestNeighborhoods = new Map(
    neighborhoodQueries.flatMap(
      ({ data }) =>
        data?.neighborhoods.map(
          (neighborhood) => [hypermediaEntityKey(neighborhood.anchor), neighborhood] as const,
        ) ?? [],
    ),
  );
  const canExplore =
    hasNextEntityPage ||
    [...latestNeighborhoods.values()].some(({ nextCursor }) => Boolean(nextCursor)) ||
    visualizedHypermedia.entities.some(({ key }) => !requestedAnchorKeys.has(key));
  return (
    <div className="relative size-full min-h-[28rem]">
      <HypermediaCanvas
        key={query.trim().toLocaleLowerCase()}
        entities={visualizedHypermedia.entities}
        pages={visualizedHypermedia.pages}
        month={month}
        selectedEntities={visualizedSelectedEntities}
        selectedKey={selectedKey}
        onSelect={handleSelect}
        onViewportSettled={handleViewportSettled}
        onMonthChange={onMonthChange}
        onIntervalScrollingChange={setIntervalScrolling}
        canExplore={canExplore}
        isInitialLoading={
          visualizedHypermedia.entities.length === 0 &&
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
      <HypermediaPageStatus
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
