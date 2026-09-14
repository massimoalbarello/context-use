import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import type { CalendarMonth } from '../lib/calendar-month';

export type MapNeighborhoods = NonNullable<
  Awaited<ReturnType<(typeof api.api.map.neighborhoods)['get']>>['data']
>;
export type MapEntity = MapNeighborhoods['entities'][number];
export type MapNeighborhoodRequest = NonNullable<
  Parameters<(typeof api.api.map.neighborhoods)['get']>[0]
>['query']['anchors'][number];
export type MapEntityReference = Pick<MapEntity, 'readableId'>;
export type MapPages = NonNullable<Awaited<ReturnType<(typeof api.api.map.pages)['get']>>['data']>;
export type MapPage = MapPages['pages'][number];

export const mapQueryKey = ['map'] as const;
const MAP_NEIGHBORHOOD_SIZE = 16;

export function mapEntityKey(entity: MapEntityReference): string {
  return `entity:${entity.readableId}`;
}

export function mapEntityReference(entity: MapEntity): MapEntityReference {
  return { readableId: entity.readableId };
}

export function mapNeighborhoodsQueryOptions(anchors: MapNeighborhoodRequest[]) {
  return queryOptions({
    queryKey: [...mapQueryKey, 'neighborhoods', anchors] as const,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.api.map.neighborhoods.get({
        query: {
          // Eden types ArrayString as its decoded array, but its wire value is JSON.
          anchors: JSON.stringify(anchors) as unknown as MapNeighborhoodRequest[],
          limit: MAP_NEIGHBORHOOD_SIZE,
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

type MapPageQuery = {
  visibleEntities: MapEntityReference[];
  month?: CalendarMonth;
};

const MAP_PAGE_LIMIT = 32;

export function mergeMapPages(batches: MapPages[]): MapPage[] {
  const pages = new Map<string, MapPage>();
  for (const page of batches.flatMap(({ pages }) => pages)) {
    const current = pages.get(page.readableId);
    if (!current || page.revisionNumber >= current.revisionNumber) {
      pages.set(page.readableId, page);
    }
  }
  return [...pages.values()];
}

export function mapPagesQueryOptions({ visibleEntities, month }: MapPageQuery) {
  const visibleEntityKeys = visibleEntities.map(({ readableId }) => readableId).sort();
  return infiniteQueryOptions({
    queryKey: [
      ...mapQueryKey,
      'pages',
      {
        visibleEntities: visibleEntityKeys,
        month: month ?? null,
      },
    ] as const,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await api.api.map.pages.get({
        query: {
          visible: visibleEntityKeys.length > 0 ? visibleEntityKeys.join(',') : undefined,
          limit: MAP_PAGE_LIMIT,
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
