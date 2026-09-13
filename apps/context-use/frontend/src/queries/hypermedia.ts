import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import type { CalendarMonth } from '../lib/calendar-month';

export type HypermediaEntityNeighborhood = NonNullable<
  Awaited<ReturnType<(typeof api.api.hypermedia.entities)['get']>>['data']
>;
export type HypermediaEntity = HypermediaEntityNeighborhood['anchor'];
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

export function hypermediaEntityNeighborhoodQueryOptions({
  anchor,
  cursor,
}: {
  anchor: HypermediaEntityReference;
  cursor?: string;
}) {
  const anchorKey = hypermediaEntityKey(anchor);
  return queryOptions({
    queryKey: [...hypermediaQueryKey, 'entities', anchorKey, { cursor: cursor ?? null }] as const,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.api.hypermedia.entities.get({
        query: {
          anchor: anchor.readableId,
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
  entities: HypermediaEntityReference[];
  visibleEntities: HypermediaEntityReference[];
  month?: CalendarMonth;
};

const HYPERMEDIA_PAGE_LIMIT = 32;

export function hypermediaPagesQueryOptions({
  entities,
  visibleEntities,
  month,
}: HypermediaPageQuery) {
  const entityKeys = entities.map(({ readableId }) => readableId).sort();
  const visibleEntityKeys = visibleEntities.map(({ readableId }) => readableId).sort();
  return infiniteQueryOptions({
    queryKey: [
      ...hypermediaQueryKey,
      'pages',
      {
        entities: entityKeys,
        visibleEntities: visibleEntityKeys,
        month: month ?? null,
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
