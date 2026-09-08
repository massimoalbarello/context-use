import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  type KnowledgePageListFilters,
  pageSuggestionsQueryOptions,
  pagesQueryOptions,
} from '../../queries/pages';

export function usePages(filters: KnowledgePageListFilters = {}) {
  const query = useInfiniteQuery(pagesQueryOptions(filters));

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
