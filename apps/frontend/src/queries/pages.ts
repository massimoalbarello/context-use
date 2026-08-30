import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type KnowledgePagePage = NonNullable<Awaited<ReturnType<typeof api.api.pages.get>>['data']>;

export type KnowledgePageSummary = KnowledgePagePage['items'][number];

export type KnowledgePage = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.pages>['get']>>['data']
>;

export const pagesQueryKey = ['pages'] as const;
export const pagesListQueryKey = [...pagesQueryKey, 'list'] as const;

export const pagesQueryOptions = infiniteQueryOptions({
  queryKey: pagesListQueryKey,
  initialPageParam: 0,
  queryFn: async ({ pageParam }) => {
    const { data, error } = await api.api.pages.get({ query: { offset: pageParam } });
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
  getNextPageParam: (page) => page.nextOffset ?? undefined,
});

export function pageQueryOptions(readableId: string) {
  return queryOptions({
    queryKey: [...pagesQueryKey, 'detail', readableId],
    queryFn: async () => {
      const { data, error } = await api.api.pages({ pageReadableId: readableId }).get();
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}
