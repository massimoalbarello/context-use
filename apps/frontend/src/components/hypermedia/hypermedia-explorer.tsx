import { useQueries } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEntities } from '../../lib/hooks/use-entities';
import {
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
  selectedResources,
  pages,
  onSelect,
}: {
  selfReadableId: string;
  selection?: HypermediaSelection;
  selectedResources: HypermediaResourceReference[];
  pages: HypermediaPage[];
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
  const selectedKey = selection ? `${selection.kind}:${selection.readableId}` : undefined;
  const requestedAnchorKeys = new Set(
    neighborhoodRequests.map(({ anchor }) => hypermediaResourceKey(anchor)),
  );
  const canExplore =
    hasNextEntityPage ||
    neighborhoodQueries.some(({ data }) => Boolean(data?.nextCursor)) ||
    resources.some(({ key }) => !requestedAnchorKeys.has(key));

  return (
    <div className="relative size-full min-h-[28rem]">
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
    </div>
  );
}
