import { infiniteQueryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export const historyQueryKey = ['history'] as const;
export type HistoryPage = NonNullable<Awaited<ReturnType<typeof api.api.history.get>>['data']>;
export type HistoryEntry = HistoryPage['items'][number];
export type HistoryResourceType = HistoryEntry['resourceType'];

export const historyQueryOptions = (resourceType?: HistoryResourceType) =>
  infiniteQueryOptions({
    queryKey: [...historyQueryKey, resourceType],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.api.history.get({
        query: { cursor: pageParam, resourceType },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
