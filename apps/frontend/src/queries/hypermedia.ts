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
export type FocusedHypermediaPages = NonNullable<
  Awaited<ReturnType<(typeof api.api.hypermedia.pages)['get']>>['data']
>;
export type HypermediaPage = FocusedHypermediaPages['pages'][number];
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

export type FocusedHypermediaPageQuery = {
  focus: HypermediaResourceReference[];
  limit: number;
  query?: string;
  dateRange?: CalendarDateRange;
  retainPageReadableId?: string;
};

export function focusedHypermediaPagesQueryOptions({
  focus,
  limit,
  query,
  dateRange,
  retainPageReadableId,
}: FocusedHypermediaPageQuery) {
  const focusKeys = focus.map(hypermediaResourceKey).sort();
  const normalizedQuery = query?.trim() || undefined;
  const time = dateRange ? calendarDateRangeExpression(dateRange) : undefined;
  return queryOptions({
    queryKey: [
      ...hypermediaQueryKey,
      'pages',
      {
        focus: focusKeys,
        limit,
        query: normalizedQuery ?? null,
        time: time ?? null,
        retainPageReadableId: retainPageReadableId ?? null,
      },
    ] as const,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.api.hypermedia.pages.get({
        query: {
          focus: focusKeys.join(','),
          limit,
          query: normalizedQuery,
          time,
          retainPage: retainPageReadableId,
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
