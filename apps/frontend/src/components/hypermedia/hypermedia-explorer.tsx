import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import {
  focusedHypermediaPagesQueryOptions,
  type HypermediaResourceReference,
  hypermediaResourceKey,
  hypermediaResourceNeighborhoodQueryOptions,
} from '../../queries/hypermedia';
import {
  HypermediaCanvas,
  type HypermediaSelection,
  type SettledHypermediaViewport,
} from './hypermedia-canvas';
import { buildStableResources } from './hypermedia-layout';

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
  selfReadableId,
  selection,
  query,
  dateRange,
  onSelect,
}: {
  selfReadableId: string;
  selection?: HypermediaSelection;
  query: string;
  dateRange?: CalendarDateRange;
  onSelect: (selection: HypermediaSelection) => void;
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
  const [focusedRequest, setFocusedRequest] = useState(() => ({
    focus: selectedResource ? [selectedResource, self] : [self],
    limit: 8,
  }));

  const neighborhoodQueries = useQueries({
    queries: neighborhoodRequests.map(hypermediaResourceNeighborhoodQueryOptions),
  });
  const neighborhoods = useMemo(
    () => neighborhoodQueries.flatMap(({ data }) => (data ? [data] : [])),
    [neighborhoodQueries],
  );
  const resources = useMemo(() => buildStableResources(neighborhoods), [neighborhoods]);

  useEffect(() => {
    if (!selectedResource) {
      return;
    }
    setNeighborhoodRequests((current) => {
      const key = hypermediaResourceKey(selectedResource);
      return current.some(({ anchor }) => hypermediaResourceKey(anchor) === key)
        ? current
        : [...current, { anchor: selectedResource }];
    });
  }, [selectedResource]);

  const pageQuery = useQuery({
    ...focusedHypermediaPagesQueryOptions({
      focus: focusedRequest.focus,
      limit: focusedRequest.limit,
      query,
      dateRange,
      retainPageReadableId: selection?.kind === 'page' ? selection.readableId : undefined,
    }),
    placeholderData: keepPreviousData,
  });

  const handleViewportSettled = useCallback(
    ({ focus, pageLimit, boundaryAnchor }: SettledHypermediaViewport) => {
      setFocusedRequest((current) => {
        const nextKeys = focus.map(hypermediaResourceKey).sort().join(',');
        const currentKeys = current.focus.map(hypermediaResourceKey).sort().join(',');
        return nextKeys === currentKeys && pageLimit === current.limit
          ? current
          : { focus, limit: pageLimit };
      });
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
    [neighborhoodQueries],
  );

  const neighborhoodError = neighborhoodQueries.find(({ error }) => error)?.error ?? null;
  const selectedKey = selection ? `${selection.kind}:${selection.readableId}` : undefined;
  const requestedAnchorKeys = new Set(
    neighborhoodRequests.map(({ anchor }) => hypermediaResourceKey(anchor)),
  );
  const canExplore =
    neighborhoodQueries.some(({ data }) => Boolean(data?.nextCursor)) ||
    resources.some(({ key }) => !requestedAnchorKeys.has(key));

  return (
    <HypermediaCanvas
      resources={resources}
      pages={pageQuery.data?.pages ?? []}
      selectedKey={selectedKey}
      onSelect={onSelect}
      onViewportSettled={handleViewportSettled}
      canExplore={canExplore}
      isInitialLoading={
        resources.length === 0 && neighborhoodQueries.some(({ isPending }) => isPending)
      }
      neighborhoodError={neighborhoodError}
      onRetryNeighborhood={() => {
        for (const result of neighborhoodQueries) {
          if (result.error) {
            void result.refetch();
          }
        }
      }}
    />
  );
}
