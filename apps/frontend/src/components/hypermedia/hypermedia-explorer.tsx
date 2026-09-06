import { useQueries } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEntities } from '../../lib/hooks/use-entities';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import {
  type HypermediaPage,
  type HypermediaPageProjection,
  type HypermediaPages,
  type HypermediaResourceReference,
  hypermediaResourceKey,
  hypermediaResourceNeighborhoodQueryOptions,
} from '../../queries/hypermedia';
import { Button } from '../ui/button';
import { HypermediaCanvas } from './hypermedia-canvas';
import { buildStableResources } from './hypermedia-layout';
import { type HypermediaSelection, hypermediaSelectionKey } from './hypermedia-selection';
import { HypermediaTemporalCanvas } from './hypermedia-temporal-canvas';
import type { SettledHypermediaViewport } from './hypermedia-visibility';

type NeighborhoodRequest = {
  anchor: HypermediaResourceReference;
  cursor?: string;
};

function requestKey(request: NeighborhoodRequest): string {
  return `${hypermediaResourceKey(request.anchor)}:${request.cursor ?? 'first'}`;
}

function resourceSelection(
  selection?: HypermediaSelection,
): HypermediaResourceReference | undefined {
  return selection && selection.kind !== 'page'
    ? { kind: selection.kind, readableId: selection.readableId }
    : undefined;
}

export function HypermediaExplorer({
  projection,
  selfReadableId,
  selection,
  selectedResources,
  pages,
  temporalExtent,
  dateRange,
  pagesLoading,
  pagesError,
  hasMorePages,
  pageReferencesTruncated,
  onSelect,
  onDateRangeApply,
  onRetryPages,
}: {
  projection: HypermediaPageProjection;
  selfReadableId: string;
  selection?: HypermediaSelection;
  selectedResources: HypermediaResourceReference[];
  pages: HypermediaPage[];
  temporalExtent: HypermediaPages['temporalExtent'];
  dateRange?: CalendarDateRange;
  pagesLoading: boolean;
  pagesError: Error | null;
  hasMorePages: boolean;
  pageReferencesTruncated: boolean;
  onSelect: (selection: HypermediaSelection) => void;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
  onRetryPages: () => void;
}) {
  const self = useMemo<HypermediaResourceReference>(
    () => ({ kind: 'entity', readableId: selfReadableId }),
    [selfReadableId],
  );
  const selectedResource = useMemo(() => resourceSelection(selection), [selection]);
  const [neighborhoodRequests, setNeighborhoodRequests] = useState<NeighborhoodRequest[]>(() => {
    const initial = [{ anchor: self }];
    return selectedResource &&
      hypermediaResourceKey(selectedResource) !== hypermediaResourceKey(self)
      ? [...initial, { anchor: selectedResource }]
      : initial;
  });
  const neighborhoodQueries = useQueries({
    queries: neighborhoodRequests.map(hypermediaResourceNeighborhoodQueryOptions),
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
  const entities = useMemo(
    () => entityData?.pages.flatMap((page) => page.items) ?? [],
    [entityData],
  );
  const [resources, setResources] = useState(() => buildStableResources([], []));

  useEffect(() => {
    setResources((current) => buildStableResources(neighborhoods, entities, current));
  }, [entities, neighborhoods]);

  useEffect(() => {
    const requestedResources = selectedResource
      ? [...selectedResources, selectedResource]
      : selectedResources;
    if (requestedResources.length === 0) {
      return;
    }
    setNeighborhoodRequests((current) => {
      const requestedKeys = new Set(current.map(({ anchor }) => hypermediaResourceKey(anchor)));
      const additional = requestedResources.filter((resource) => {
        const key = hypermediaResourceKey(resource);
        if (requestedKeys.has(key)) {
          return false;
        }
        requestedKeys.add(key);
        return true;
      });
      return additional.length > 0
        ? [...current, ...additional.map((anchor) => ({ anchor }))]
        : current;
    });
  }, [selectedResource, selectedResources]);

  const handleViewportSettled = useCallback(
    ({ focus, discoverMoreEntities, boundaryAnchor }: SettledHypermediaViewport) => {
      if (discoverMoreEntities && hasNextEntityPage && !isFetchingNextEntityPage) {
        void fetchNextEntityPage();
      }
      if (!boundaryAnchor || neighborhoodQueries.some(({ isPending }) => isPending)) {
        return;
      }
      setNeighborhoodRequests((current) => {
        const candidates = [
          boundaryAnchor,
          ...focus.filter(
            (resource) => hypermediaResourceKey(resource) !== hypermediaResourceKey(boundaryAnchor),
          ),
        ];
        const anchor = candidates.find((candidate) => {
          const key = hypermediaResourceKey(candidate);
          const matchingRequests = current.filter(
            (request) => hypermediaResourceKey(request.anchor) === key,
          );
          const lastRequest = matchingRequests.at(-1);
          const result = lastRequest
            ? neighborhoodQueries[current.indexOf(lastRequest)]
            : undefined;
          return matchingRequests.length === 0 || Boolean(result?.data?.nextCursor);
        });
        if (!anchor) {
          return current;
        }
        const anchorKey = hypermediaResourceKey(anchor);
        const matching = current.flatMap((request) =>
          hypermediaResourceKey(request.anchor) === anchorKey
            ? [{ request, result: neighborhoodQueries[current.indexOf(request)] }]
            : [],
        );
        const nextCursor = matching.at(-1)?.result?.data?.nextCursor ?? undefined;
        const next = { anchor, cursor: nextCursor };
        return current.some((request) => requestKey(request) === requestKey(next))
          ? current
          : [...current, next];
      });
    },
    [fetchNextEntityPage, hasNextEntityPage, isFetchingNextEntityPage, neighborhoodQueries],
  );

  const neighborhoodError =
    neighborhoodQueries.find(({ error }) => error)?.error ?? entityError ?? null;
  const selectedKey = selection ? hypermediaSelectionKey(selection) : undefined;
  const requestedAnchorKeys = new Set(
    neighborhoodRequests.map(({ anchor }) => hypermediaResourceKey(anchor)),
  );
  const canExplore =
    hasNextEntityPage ||
    neighborhoodQueries.some(({ data }) => Boolean(data?.nextCursor)) ||
    resources.some(({ key }) => !requestedAnchorKeys.has(key));

  return (
    <div className="relative size-full min-h-[28rem]">
      {projection === 'semantic' ? (
        <HypermediaCanvas
          resources={resources}
          pages={pages}
          selectedResources={selectedResources}
          selectedKey={selectedKey}
          onSelect={onSelect}
          onViewportSettled={handleViewportSettled}
          canExplore={canExplore}
          isInitialLoading={
            resources.length === 0 &&
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
      ) : (
        <HypermediaTemporalCanvas
          resources={resources}
          pages={pages}
          extent={temporalExtent}
          dateRange={dateRange}
          selectedResources={selectedResources}
          selectedKey={selectedKey}
          onSelect={onSelect}
          onDateRangeApply={onDateRangeApply}
          onViewportSettled={handleViewportSettled}
        />
      )}
      <HypermediaPageStatus
        projection={projection}
        pageCount={pages.length}
        loading={pagesLoading}
        error={pagesError}
        hasMorePages={hasMorePages}
        referencesTruncated={pageReferencesTruncated}
        onRetry={onRetryPages}
      />
    </div>
  );
}

function HypermediaPageStatus({
  projection,
  pageCount,
  loading,
  error,
  hasMorePages,
  referencesTruncated,
  onRetry,
}: {
  projection: HypermediaPageProjection;
  pageCount: number;
  loading: boolean;
  error: Error | null;
  hasMorePages: boolean;
  referencesTruncated: boolean;
  onRetry: () => void;
}) {
  if (!loading && !error && !hasMorePages && !referencesTruncated && pageCount > 0) {
    return null;
  }
  let message: string | undefined;
  if (error) {
    message = `Couldn’t load ${projection} pages.`;
  } else if (loading) {
    message = `Loading ${projection} pages…`;
  } else if (hasMorePages || referencesTruncated) {
    message =
      projection === 'temporal'
        ? 'More temporal context is available. Scroll to a narrower interval or select resources.'
        : 'More semantic context is available. Select resources or refine the keyword.';
  } else if (pageCount === 0) {
    message = `No ${projection} pages match this view.`;
  }
  if (!message) {
    return null;
  }
  return (
    <div
      className="absolute right-4 bottom-4 z-20 flex items-center gap-2 rounded-full border bg-card/92 px-3 py-2 text-muted-foreground text-xs shadow-sm backdrop-blur"
      role={error ? 'alert' : 'status'}
    >
      {loading && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
      <span>{message}</span>
      {error && (
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
