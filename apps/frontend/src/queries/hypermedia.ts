import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import type { CalendarMonth } from '../lib/calendar-month';

export type HypermediaNeighborhoods = NonNullable<
  Awaited<ReturnType<(typeof api.api.hypermedia.neighborhoods)['post']>>['data']
>;
export type HypermediaEntity = HypermediaNeighborhoods['entities'][number];
export type HypermediaNeighborhoodRequest = Parameters<
  (typeof api.api.hypermedia.neighborhoods)['post']
>[0]['anchors'][number];
export type HypermediaEntityReference = Pick<HypermediaEntity, 'readableId'>;
export type HypermediaPages = NonNullable<
  Awaited<ReturnType<(typeof api.api.hypermedia.pages)['get']>>['data']
>;
export type HypermediaPage = HypermediaPages['pages'][number];

export const hypermediaQueryKey = ['hypermedia'] as const;
const HYPERMEDIA_NEIGHBORHOOD_SIZE = 16;

export function hypermediaEntityKey(entity: HypermediaEntityReference): string {
  return `entity:${entity.readableId}`;
}

export function hypermediaEntityReference(entity: HypermediaEntity): HypermediaEntityReference {
  return { readableId: entity.readableId };
}

export function hypermediaNeighborhoodsQueryOptions(anchors: HypermediaNeighborhoodRequest[]) {
  return queryOptions({
    queryKey: [...hypermediaQueryKey, 'neighborhoods', anchors] as const,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.api.hypermedia.neighborhoods.post(
        {
          anchors,
          limit: HYPERMEDIA_NEIGHBORHOOD_SIZE,
        },
        {
          fetch: { signal },
        },
      );
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

type HypermediaPageQuery = {
  entities: HypermediaEntityReference[];
  visibleEntities: HypermediaEntityReference[];
  month?: CalendarMonth;
  query?: string;
};

const HYPERMEDIA_PAGE_LIMIT = 32;

export function mergeHypermediaPages(batches: HypermediaPages[]): HypermediaPage[] {
  const pages = new Map<string, HypermediaPage>();
  for (const page of batches.flatMap(({ pages }) => pages)) {
    const current = pages.get(page.readableId);
    if (!current || page.revisionNumber >= current.revisionNumber) {
      pages.set(page.readableId, page);
    }
  }
  return [...pages.values()];
}

export function hypermediaPagesQueryOptions({
  entities,
  visibleEntities,
  month,
  query,
}: HypermediaPageQuery) {
  const entityKeys = entities.map(({ readableId }) => readableId).sort();
  const visibleEntityKeys = visibleEntities.map(({ readableId }) => readableId).sort();
  const normalizedQuery = query?.trim() || undefined;
  return infiniteQueryOptions({
    queryKey: [
      ...hypermediaQueryKey,
      'pages',
      {
        entities: entityKeys,
        visibleEntities: visibleEntityKeys,
        month: month ?? null,
        query: normalizedQuery ?? null,
      },
    ] as const,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await api.api.hypermedia.pages.get({
        query: {
          entities: entityKeys.length > 0 ? entityKeys.join(',') : undefined,
          visible: visibleEntityKeys.length > 0 ? visibleEntityKeys.join(',') : undefined,
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
