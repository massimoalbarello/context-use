import { useQueries } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarMonth } from '../../lib/calendar-month';
import { useEntities } from '../../lib/hooks/use-entities';
import {
  type HypermediaEntityReference,
  type HypermediaPage,
  hypermediaEntityKey,
  hypermediaEntityNeighborhoodQueryOptions,
} from '../../queries/hypermedia';
import { Button } from '../ui/button';
import { HypermediaCanvas } from './hypermedia-canvas';
import { buildStableEntities } from './hypermedia-layout';
import { type HypermediaSelection, hypermediaSelectionKey } from './hypermedia-selection';
import type { SettledHypermediaViewport } from './hypermedia-visibility';

type NeighborhoodRequest = {
  anchor: HypermediaEntityReference;
  cursor?: string;
};

function requestKey(request: NeighborhoodRequest): string {
  return `${hypermediaEntityKey(request.anchor)}:${request.cursor ?? 'first'}`;
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

function neighborhoodRequestsForEntities({
  entities,
  initial = [],
}: {
  entities: HypermediaEntityReference[];
  initial?: NeighborhoodRequest[];
}): NeighborhoodRequest[] {
  let requests = initial;
  for (const anchor of entities) {
    requests = appendNeighborhoodRequest({ current: requests, request: { anchor } });
  }
  return requests;
}

function entitySelection(selection?: HypermediaSelection): HypermediaEntityReference | undefined {
  return selection && selection.kind !== 'page' ? { readableId: selection.readableId } : undefined;
}

export function HypermediaExplorer({
  selfReadableId,
  selection,
  selectedEntities,
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
  selection?: HypermediaSelection;
  selectedEntities: HypermediaEntityReference[];
  pages: HypermediaPage[];
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
    NeighborhoodRequest[]
  >(() => neighborhoodRequestsForEntities({ entities: [self, ...selectedNeighborhoodEntities] }));
  const neighborhoodRequests = useMemo(
    () =>
      neighborhoodRequestsForEntities({
        entities: selectedNeighborhoodEntities,
        initial: exploredNeighborhoodRequests,
      }),
    [exploredNeighborhoodRequests, selectedNeighborhoodEntities],
  );
  const neighborhoodQueries = useQueries({
    queries: neighborhoodRequests.map((request) =>
      hypermediaEntityNeighborhoodQueryOptions(request),
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
      const anchor = candidates.find((candidate) => {
        const key = hypermediaEntityKey(candidate);
        const matchingRequests = neighborhoodRequests.filter(
          (request) => hypermediaEntityKey(request.anchor) === key,
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
      const anchorKey = hypermediaEntityKey(anchor);
      const matching = neighborhoodRequests.flatMap((request) =>
        hypermediaEntityKey(request.anchor) === anchorKey
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
      onVisibleEntitiesChange,
    ],
  );

  const handleSelect = useCallback(
    (nextSelection: HypermediaSelection) => {
      const entity = entitySelection(nextSelection);
      if (entity) {
        setExploredNeighborhoodRequests((current) =>
          appendNeighborhoodRequest({ current, request: { anchor: entity } }),
        );
      }
      onSelect(nextSelection);
    },
    [onSelect],
  );

  const neighborhoodError = neighborhoodQueries.find(({ error }) => error)?.error ?? entityError;
  const selectedKey = selection ? hypermediaSelectionKey(selection) : undefined;
  const requestedAnchorKeys = new Set(
    neighborhoodRequests.map(({ anchor }) => hypermediaEntityKey(anchor)),
  );
  const canExplore =
    hasNextEntityPage ||
    neighborhoodQueries.some(({ data }) => Boolean(data?.nextCursor)) ||
    entities.some(({ key }) => !requestedAnchorKeys.has(key));
  return (
    <div className="relative size-full min-h-[28rem]">
      <HypermediaCanvas
        entities={entities}
        pages={pages}
        month={month}
        selectedEntities={selectedEntities}
        selectedKey={selectedKey}
        onSelect={handleSelect}
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
