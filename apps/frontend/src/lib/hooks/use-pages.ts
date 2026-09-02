import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { pageSuggestionsQueryOptions, pagesQueryOptions } from '../../queries/pages';
import type { CalendarDateRange } from '../temporal-coverage';

export function usePages(dateRange?: CalendarDateRange) {
  const query = useInfiniteQuery(pagesQueryOptions(dateRange));

  return {
    ...query,
    pages: query.data?.pages.flatMap((page) => page.items) ?? [],
    total: query.data?.pages[0]?.total ?? 0,
  };
}

export function usePageSuggestions(query: string | null) {
  return useQuery({
    ...pageSuggestionsQueryOptions(query ?? ''),
    enabled: query !== null,
  });
}
