import type { RecordListFilters } from '@repo/backend/record';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type ExternalRecordPage = NonNullable<
  Awaited<ReturnType<typeof api.api.records.get>>['data']
>;
export type ExternalRecordSummary = ExternalRecordPage['items'][number];
export type ExternalRecord = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.records>['get']>>['data']
>;

export const recordsQueryKey = ['records'] as const;
export const recordsListQueryKey = [...recordsQueryKey, 'list'] as const;
export const recordDetailsQueryKey = [...recordsQueryKey, 'detail'] as const;

export function recordsQueryOptions(filters: RecordListFilters = {}) {
  return infiniteQueryOptions({
    queryKey: [...recordsListQueryKey, filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.api.records.get({
        query: { ...filters, offset: pageParam },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
}

export function recordQueryOptions(readableId: string) {
  return queryOptions({
    queryKey: [...recordDetailsQueryKey, readableId],
    queryFn: async () => {
      const { data, error } = await api.api.records({ recordReadableId: readableId }).get();
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}
