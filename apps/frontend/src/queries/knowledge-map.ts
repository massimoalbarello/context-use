import { infiniteQueryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import { type CalendarDateRange, calendarDateRangeExpression } from '../lib/temporal-coverage';

export type KnowledgeMapBatch = NonNullable<
  Awaited<ReturnType<(typeof api.api)['knowledge-map']['get']>>['data']
>;
export type KnowledgeMapPage = KnowledgeMapBatch['pages'][number];
export type KnowledgeMapEntity = KnowledgeMapPage['mentions'][number];
export type KnowledgeMapAsset = KnowledgeMapPage['assetUsages'][number]['asset'];
export type KnowledgeMap = {
  pages: KnowledgeMapPage[];
  truncated: boolean;
};

export const knowledgeMapQueryKey = ['knowledge-map'] as const;
export const KNOWLEDGE_MAP_BATCH_SIZE = 8;

export type KnowledgeMapFilters = {
  query?: string;
  dateRange?: CalendarDateRange;
};

export function knowledgeMapQueryOptions(filters: KnowledgeMapFilters = {}) {
  const query = filters.query?.trim() || undefined;
  const time = filters.dateRange ? calendarDateRangeExpression(filters.dateRange) : undefined;

  return infiniteQueryOptions({
    queryKey: [...knowledgeMapQueryKey, { query: query ?? null, time: time ?? null }] as const,
    initialPageParam: undefined as string | undefined,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.api['knowledge-map'].get({
        query: { cursor: pageParam, limit: KNOWLEDGE_MAP_BATCH_SIZE, query, time },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    getNextPageParam: (batch) => batch.nextCursor ?? undefined,
  });
}

export function knowledgeMapFrom(batches: KnowledgeMapBatch[]): KnowledgeMap {
  const seenPages = new Set<string>();
  return {
    pages: batches.flatMap((batch) =>
      batch.pages.filter((page) => {
        if (seenPages.has(page.readableId)) {
          return false;
        }
        seenPages.add(page.readableId);
        return true;
      }),
    ),
    truncated: batches.some((batch) => batch.truncated),
  };
}
