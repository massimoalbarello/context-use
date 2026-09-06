import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import { type CalendarDateRange, calendarDateRangeExpression } from '../lib/temporal-coverage';

export type HypermediaResourceNeighborhood = NonNullable<
  Awaited<ReturnType<(typeof api.api.hypermedia.resources)['get']>>['data']
>;
export type HypermediaResource = HypermediaResourceNeighborhood['anchor'];
export type HypermediaResourceReference =
  | { kind: 'entity'; readableId: string }
  | { kind: 'asset'; readableId: string };
export type HypermediaPages = NonNullable<
  Awaited<ReturnType<(typeof api.api.hypermedia.pages)['get']>>['data']
>;
export type HypermediaPage = HypermediaPages['pages'][number];
export type HypermediaEntity = Extract<HypermediaResource, { kind: 'entity' }>['entity'];
export type HypermediaAsset = Extract<HypermediaResource, { kind: 'asset' }>['asset'];

export const hypermediaQueryKey = ['hypermedia'] as const;
export const HYPERMEDIA_NEIGHBORHOOD_SIZE = 16;

export function hypermediaResourceKey(resource: HypermediaResourceReference): string {
  return `${resource.kind}:${resource.readableId}`;
}

export function hypermediaResourceReference(
  resource: HypermediaResource,
): HypermediaResourceReference {
  return resource.kind === 'entity'
    ? { kind: 'entity', readableId: resource.entity.readableId }
    : { kind: 'asset', readableId: resource.asset.readableId };
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
    queryKey: [...hypermediaQueryKey, 'resources', anchorKey, cursor ?? null] as const,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.api.hypermedia.resources.get({
        query: { anchor: anchorKey, cursor, limit: HYPERMEDIA_NEIGHBORHOOD_SIZE },
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

export type HypermediaPageQuery = {
  resources: HypermediaResourceReference[];
  query?: string;
  dateRange?: CalendarDateRange;
};

export const HYPERMEDIA_PAGE_LIMIT = 32;

export function hypermediaPagesQueryOptions({ resources, query, dateRange }: HypermediaPageQuery) {
  const resourceKeys = resources.map(hypermediaResourceKey).sort();
  const normalizedQuery = query?.trim() || undefined;
  const time = dateRange ? calendarDateRangeExpression(dateRange) : undefined;
  return queryOptions({
    queryKey: [
      ...hypermediaQueryKey,
      'pages',
      {
        resources: resourceKeys,
        query: normalizedQuery ?? null,
        time: time ?? null,
      },
    ] as const,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.api.hypermedia.pages.get({
        query: {
          resources: resourceKeys.length > 0 ? resourceKeys.join(',') : undefined,
          limit: HYPERMEDIA_PAGE_LIMIT,
          query: normalizedQuery,
          time,
        },
        fetch: { signal },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}
