import { useInfiniteQuery } from '@tanstack/react-query';
import { pagesQueryOptions } from '../../queries/pages';

export function usePages() {
  const query = useInfiniteQuery(pagesQueryOptions);

  return {
    ...query,
    pages: query.data?.pages.flatMap((page) => page.items) ?? [],
    total: query.data?.pages[0]?.total ?? 0,
  };
}
