import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type KnowledgePageSummary = NonNullable<
  Awaited<ReturnType<typeof api.api.pages.get>>['data']
>[number];

export type KnowledgePage = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.pages>['get']>>['data']
>;

export const pagesQueryKey = ['pages'] as const;

export const pagesQueryOptions = queryOptions({
  queryKey: pagesQueryKey,
  queryFn: async () => {
    const { data, error } = await api.api.pages.get();
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});

export function pageQueryOptions(readableId: string) {
  return queryOptions({
    queryKey: [...pagesQueryKey, readableId],
    queryFn: async () => {
      const { data, error } = await api.api.pages({ pageReadableId: readableId }).get();
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}
