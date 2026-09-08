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
import type { PageTypeFilterValue } from '../pages/page-type-filter';
import { Button } from '../ui/button';
import { HypermediaCanvas } from './hypermedia-canvas';
import { buildStableResources } from './hypermedia-layout';
import { filterHypermedia, type HypermediaResourceKind } from './hypermedia-resource-filter';
import { type HypermediaSelection, hypermediaSelectionKey } from './hypermedia-selection';
import { HypermediaTemporalCanvas } from './hypermedia-temporal-canvas';
import type { SettledHypermediaViewport } from './hypermedia-visibility';

type NeighborhoodRequest = {
  anchor: HypermediaResourceReference;
  cursor?: string;
};

function pageTypeLabel(pageType: PageTypeFilterValue): string {
  return pageType === 'all' ? 'pages' : `${pageType} pages`;
}

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
  pageType,
  projection,
  resourceKinds,
  selfReadableId,
  selection,
  selectedResources,
  query,
  pages,
  temporalExtent,
  dateRange,
  pagesLoading,
  pagesError,
  hasNextPage,
  pageReferencesTruncated,
  isFetchingNextPage,
  onSelect,
  onDateRangeApply,
  onRetryPages,
  onDiscoverMorePages,
}: {
  pageType: PageTypeFilterValue;
  projection: HypermediaPageProjection;
  resourceKinds: HypermediaResourceKind[];
  selfReadableId: string;
  selection?: HypermediaSelection;
  selectedResources: HypermediaResourceReference[];
  query: string;
  pages: HypermediaPage[];
  temporalExtent: HypermediaPages['temporalExtent'];
  dateRange?: CalendarDateRange;
  pagesLoading: boolean;
  pagesError: Error | null;
  hasNextPage: boolean;
  pageReferencesTruncated: boolean;
  isFetchingNextPage: boolean;
  onSelect: (selection: HypermediaSelection) => void;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
  onRetryPages: () => void;
  onDiscoverMorePages: () => void;
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
    [
      fetchNextEntityPage,
      hasNextEntityPage,
      isFetchingNextEntityPage,
      neighborhoodQueries,
      resourceKinds,
    ],
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
      {projection === 'semantic' ? (
        <HypermediaCanvas
          key={query.trim().toLocaleLowerCase()}
          resources={visualizedHypermedia.resources}
          pages={visualizedHypermedia.pages}
          selectedResources={visualizedSelectedResources}
          selectedKey={selectedKey}
          onSelect={onSelect}
          onViewportSettled={handleViewportSettled}
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
        <HypermediaTemporalCanvas
          key={query.trim().toLocaleLowerCase()}
          resources={visualizedHypermedia.resources}
          pages={visualizedHypermedia.pages}
          extent={temporalExtent}
          dateRange={dateRange}
          selectedResources={visualizedSelectedResources}
          selectedKey={selectedKey}
          onSelect={onSelect}
          onDateRangeApply={onDateRangeApply}
          onViewportSettled={handleViewportSettled}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onDiscoverMorePages={onDiscoverMorePages}
        />
      )}
      <HypermediaPageStatus
        pageType={pageType}
        pageCount={pages.length}
        loading={pagesLoading}
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
  pageType,
  pageCount,
  loading,
  error,
  hasNextPage,
  referencesTruncated,
  onRetry,
  onLoadMore,
}: {
  pageType: PageTypeFilterValue;
  pageCount: number;
  loading: boolean;
  error: Error | null;
  hasNextPage: boolean;
  referencesTruncated: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  const canLoadMore = pageType !== 'temporal' && hasNextPage;
  const pageLabel = pageTypeLabel(pageType);
  if (!loading && !error && pageCount > 0 && !canLoadMore && !referencesTruncated) {
    return null;
  }
  let message: string | undefined;
  if (error) {
    message = `Couldn’t load ${pageLabel}.`;
  } else if (loading) {
    message = `Loading ${pageLabel}…`;
  } else if (pageCount === 0) {
    message = `No ${pageLabel} match this view.`;
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
