import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import type { CalendarMonth } from '../lib/calendar-month';

export type HypermediaResourceNeighborhood = NonNullable<
  Awaited<ReturnType<(typeof api.api.hypermedia.resources)['get']>>['data']
>;
export type HypermediaResource = HypermediaResourceNeighborhood['anchor'];
export type HypermediaResourceReference = { kind: 'entity'; readableId: string };
export type HypermediaPages = NonNullable<
  Awaited<ReturnType<(typeof api.api.hypermedia.pages)['get']>>['data']
>;
export type HypermediaPage = HypermediaPages['pages'][number];
export type HypermediaEntity = HypermediaResource['entity'];

export const hypermediaQueryKey = ['hypermedia'] as const;
const HYPERMEDIA_NEIGHBORHOOD_SIZE = 16;

export function hypermediaResourceKey(resource: HypermediaResourceReference): string {
  return `${resource.kind}:${resource.readableId}`;
}

export function hypermediaResourceReference(
  resource: HypermediaResource,
): HypermediaResourceReference {
  return { kind: 'entity', readableId: resource.entity.readableId };
}

export function hypermediaResourceNeighborhoodQueryOptions({
  anchor,
  cursor,
}: {
  anchor: HypermediaResourceReference;
  cursor?: string;
}) {
  const anchorKey = hypermediaResourceKey(anchor);
  return queryOptions({
    queryKey: [...hypermediaQueryKey, 'resources', anchorKey, { cursor: cursor ?? null }] as const,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.api.hypermedia.resources.get({
        query: {
          anchor: anchorKey,
          cursor,
          limit: HYPERMEDIA_NEIGHBORHOOD_SIZE,
        },
        fetch: { signal },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

type HypermediaPageQuery = {
  resources: HypermediaResourceReference[];
  visibleResources: HypermediaResourceReference[];
  month?: CalendarMonth;
  query?: string;
};

const HYPERMEDIA_PAGE_LIMIT = 32;

export function hypermediaPagesQueryOptions({
  resources,
  visibleResources,
  month,
  query,
}: HypermediaPageQuery) {
  const resourceKeys = resources.map(hypermediaResourceKey).sort();
  const visibleResourceKeys = visibleResources.map(hypermediaResourceKey).sort();
  const normalizedQuery = query?.trim() || undefined;
  return infiniteQueryOptions({
    queryKey: [
      ...hypermediaQueryKey,
      'pages',
      {
        resources: resourceKeys,
        visibleResources: visibleResourceKeys,
        month: month ?? null,
        query: normalizedQuery ?? null,
      },
    ] as const,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await api.api.hypermedia.pages.get({
        query: {
          resources: resourceKeys.length > 0 ? resourceKeys.join(',') : undefined,
          visible: visibleResourceKeys.length > 0 ? visibleResourceKeys.join(',') : undefined,
          limit: HYPERMEDIA_PAGE_LIMIT,
          offset: pageParam,
          time: month,
          query: normalizedQuery,
        },
        fetch: { signal },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
}
