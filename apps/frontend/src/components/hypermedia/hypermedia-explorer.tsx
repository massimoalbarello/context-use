import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEntities } from '../../lib/hooks/use-entities';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import {
  focusedHypermediaPagesQueryOptions,
  type HypermediaPage,
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
import { INITIAL_FOCUSED_PAGE_LIMIT } from './hypermedia-visibility';

type NeighborhoodRequest = {
  anchor: HypermediaResourceReference;
  cursor?: string;
};

const EMPTY_PAGES: HypermediaPage[] = [];

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
    limit: INITIAL_FOCUSED_PAGE_LIMIT,
  }));

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
    }),
    placeholderData: keepPreviousData,
  });
  const selectedPageReadableId = selection?.kind === 'page' ? selection.readableId : undefined;
  const focusedPages = pageQuery.data?.pages ?? EMPTY_PAGES;
  const selectedFocusedPage = focusedPages.find(
    ({ readableId }) => readableId === selectedPageReadableId,
  );
  const retainedPageQuery = useQuery({
    ...focusedHypermediaPagesQueryOptions({
      focus: [self],
      limit: 1,
      retainPageReadableId: selectedPageReadableId,
    }),
    enabled: Boolean(selectedPageReadableId),
    initialData: selectedFocusedPage
      ? { pages: [selectedFocusedPage], nextCursor: null, truncated: false }
      : undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const pages = useMemo(() => {
    if (!selectedPageReadableId || selectedFocusedPage) {
      return focusedPages;
    }
    const retainedPage = retainedPageQuery.data?.pages.find(
      ({ readableId }) => readableId === selectedPageReadableId,
    );
    return retainedPage ? [...focusedPages, retainedPage] : focusedPages;
  }, [focusedPages, retainedPageQuery.data, selectedFocusedPage, selectedPageReadableId]);

  const handleViewportSettled = useCallback(
    ({ focus, pageLimit, discoverMoreEntities, boundaryAnchor }: SettledHypermediaViewport) => {
      if (focus.length > 0) {
        setFocusedRequest((current) => {
          const nextKeys = focus.map(hypermediaResourceKey).sort().join(',');
          const currentKeys = current.focus.map(hypermediaResourceKey).sort().join(',');
          return nextKeys === currentKeys && pageLimit === current.limit
            ? current
            : { focus, limit: pageLimit };
        });
      }
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
  const selectedKey = selection ? `${selection.kind}:${selection.readableId}` : undefined;
  const requestedAnchorKeys = new Set(
    neighborhoodRequests.map(({ anchor }) => hypermediaResourceKey(anchor)),
  );
  const canExplore =
    hasNextEntityPage ||
    neighborhoodQueries.some(({ data }) => Boolean(data?.nextCursor)) ||
    resources.some(({ key }) => !requestedAnchorKeys.has(key));

  return (
    <HypermediaCanvas
      resources={resources}
      pages={pages}
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
  );
}
