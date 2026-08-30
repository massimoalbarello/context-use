import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type EntityPage = NonNullable<Awaited<ReturnType<typeof api.api.entities.get>>['data']>;

export type EntitySummary = EntityPage['items'][number];

export type EntityDetail = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.entities>['get']>>['data']
>;

export const entitiesQueryKey = ['entities'] as const;
export const entitiesListQueryKey = [...entitiesQueryKey, 'list'] as const;

export const entitiesQueryOptions = infiniteQueryOptions({
  queryKey: entitiesListQueryKey,
  initialPageParam: 0,
  queryFn: async ({ pageParam }) => {
    const { data, error } = await api.api.entities.get({ query: { offset: pageParam } });
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
  getNextPageParam: (page) => page.nextOffset ?? undefined,
});

export function entitySuggestionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: [...entitiesQueryKey, 'suggestions', query],
    queryFn: async () => {
      const { data, error } = await api.api.entities.get({
        query: { limit: 7, offset: 0, query },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data.items;
    },
  });
}

export function entityQueryOptions(readableId: string) {
  return queryOptions({
    queryKey: [...entitiesQueryKey, 'detail', readableId],
    queryFn: async () => {
      const { data, error } = await api.api.entities({ entityReadableId: readableId }).get();
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}
