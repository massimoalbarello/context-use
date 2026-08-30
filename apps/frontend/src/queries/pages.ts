import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ApiStatus, apiErrorMessage, DuplicateResourceNameError } from '../lib/api-error';

export type KnowledgePagePage = NonNullable<Awaited<ReturnType<typeof api.api.pages.get>>['data']>;

export type KnowledgePageSummary = KnowledgePagePage['items'][number];

export type KnowledgePage = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.pages>['get']>>['data']
>;

export type CreatePageVariables = Parameters<typeof api.api.pages.post>[0];
export type UpdatePageVariables = {
  readableId: string;
  body: Parameters<ReturnType<typeof api.api.pages>['put']>[0];
};

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

export function pageSuggestionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: [...pagesQueryKey, 'suggestions', query],
    queryFn: async () => {
      const { data, error } = await api.api.pages.get({
        query: { limit: 7, offset: 0, query },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data.items;
    },
  });
}

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

export async function createPage(body: CreatePageVariables): Promise<{ readableId: string }> {
  const { data, error } = await api.api.pages.post(body);
  if (error) {
    if (error.status === ApiStatus.Conflict && 'nameConflict' in error.value) {
      throw new DuplicateResourceNameError(apiErrorMessage(error));
    }
    throw new Error(apiErrorMessage(error));
  }
  return { readableId: data.readableId };
}

export async function updatePage({ readableId, body }: UpdatePageVariables): Promise<void> {
  const { error } = await api.api.pages({ pageReadableId: readableId }).put(body);
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}
