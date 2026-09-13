import { useInfiniteQuery } from '@tanstack/react-query';
import { type KnowledgePageListFilters, pagesQueryOptions } from '../../queries/pages';

export function usePages(filters: KnowledgePageListFilters = {}) {
  const query = useInfiniteQuery(pagesQueryOptions(filters));

  return {
    ...query,
    pages: query.data?.pages.flatMap((page) => page.items) ?? [],
    total: query.data?.pages[0]?.total ?? 0,
  };
}
