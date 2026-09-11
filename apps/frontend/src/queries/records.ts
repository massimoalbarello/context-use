import type { RecordListFilters } from '@repo/backend/record';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import { searchHypermedia } from './hypermedia-search';

export type RecordCollectionFilters = RecordListFilters & { query?: string };

export type ExternalRecordPage = NonNullable<
  Awaited<ReturnType<typeof api.api.records.get>>['data']
>;
export type ExternalRecordSummary = ExternalRecordPage['items'][number];
export type ExternalRecord = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.records>['get']>>['data']
>;

export const recordsQueryKey = ['records'] as const;
export const recordsListQueryKey = [...recordsQueryKey, 'list'] as const;
export const recordSuggestionsQueryKey = [...recordsQueryKey, 'suggestions'] as const;
export const recordDetailsQueryKey = [...recordsQueryKey, 'detail'] as const;

export function recordsQueryOptions(filters: RecordCollectionFilters = {}) {
  return infiniteQueryOptions({
    queryKey: [...recordsListQueryKey, filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { query, ...browseFilters } = filters;
      if (query?.trim()) {
        const [result, { data: filterOptions, error }] = await Promise.all([
          searchHypermedia({
            query,
            resourceTypes: 'record',
            recordProvider: filters.provider,
            recordKind: filters.kind,
            recordCreatedFrom: filters.createdFrom,
            recordCreatedTo: filters.createdTo,
            recordUpdatedFrom: filters.updatedFrom,
            recordUpdatedTo: filters.updatedTo,
          }),
          api.api.records['filter-options'].get(),
        ]);
        if (error) {
          throw new Error(apiErrorMessage(error));
        }
        return {
          items: result.results.flatMap((hit) =>
            hit.resourceType === 'record' ? [hit.record] : [],
          ),
          filterOptions,
          nextOffset: null,
        };
      }
      const { data, error } = await api.api.records.get({
        query: { ...browseFilters, offset: pageParam },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
}

export function recordSuggestionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: [...recordSuggestionsQueryKey, query],
    queryFn: async () => {
      if (query.trim()) {
        const result = await searchHypermedia({ query, resourceTypes: 'record', limit: 7 });
        return result.results.flatMap((hit) => (hit.resourceType === 'record' ? [hit.record] : []));
      }
      const { data, error } = await api.api.records.get({ query: { limit: 7, offset: 0 } });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data.items;
    },
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
