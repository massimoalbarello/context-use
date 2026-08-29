import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type EntitySummary = NonNullable<
  Awaited<ReturnType<typeof api.api.entities.get>>['data']
>[number];

export type EntityDetail = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.entities>['get']>>['data']
>;

export const entitiesQueryKey = ['entities'] as const;

export const entitiesQueryOptions = queryOptions({
  queryKey: entitiesQueryKey,
  queryFn: async () => {
    const { data, error } = await api.api.entities.get();
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});

export function entityQueryOptions(readableId: string) {
  return queryOptions({
    queryKey: [...entitiesQueryKey, readableId],
    queryFn: async () => {
      const { data, error } = await api.api.entities({ entityReadableId: readableId }).get();
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}
