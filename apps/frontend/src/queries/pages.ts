import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ApiStatus, apiErrorMessage, DuplicateResourceNameError } from '../lib/api-error';

export type KnowledgePagePage = NonNullable<Awaited<ReturnType<typeof api.api.pages.get>>['data']>;

export type KnowledgePageSummary = KnowledgePagePage['items'][number];

export type KnowledgePage = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.pages>['get']>>['data']
>;
export type KnowledgePageReference = KnowledgePage['references'][number];

export type CreatePageVariables = Parameters<typeof api.api.pages.post>[0];
export type UpdatePageVariables = {
  readableId: string;
  body: Parameters<ReturnType<typeof api.api.pages>['put']>[0];
};
export type ArchivePageVariables = { readableId: string };
export type ArchivePageResult =
  | { state: 'archived' }
  | { state: 'resource_in_use'; blockers: KnowledgePageReference[] };

export const pagesQueryKey = ['pages'] as const;
export const pagesListQueryKey = [...pagesQueryKey, 'list'] as const;
export const pageDetailsQueryKey = [...pagesQueryKey, 'detail'] as const;
export const pageSuggestionsQueryKey = [...pagesQueryKey, 'suggestions'] as const;

export function pagesQueryOptions(time?: string) {
  return infiniteQueryOptions({
    queryKey: [...pagesListQueryKey, { time: time ?? null }],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.api.pages.get({
        query: { offset: pageParam, time },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
}

export function pageSuggestionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: [...pageSuggestionsQueryKey, query],
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
    queryKey: [...pageDetailsQueryKey, readableId],
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

export async function archivePage({
  readableId,
}: ArchivePageVariables): Promise<ArchivePageResult> {
  const { error } = await api.api.pages({ pageReadableId: readableId }).archive.put();
  if (error) {
    if (error.status === ApiStatus.Conflict && 'blockers' in error.value) {
      return { state: 'resource_in_use', blockers: error.value.blockers };
    }
    throw new Error(apiErrorMessage(error));
  }
  return { state: 'archived' };
}
