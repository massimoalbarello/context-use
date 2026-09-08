import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { entitiesQueryOptions, entitySuggestionsQueryOptions } from '../../queries/entities';

export function useEntities({ enabled = true, query }: { enabled?: boolean; query?: string } = {}) {
  const result = useInfiniteQuery({ ...entitiesQueryOptions(query), enabled });

  return {
    ...result,
    entities: result.data?.pages.flatMap((page) => page.items) ?? [],
    total: result.data?.pages[0]?.total ?? 0,
  };
}

export function useEntitySuggestions(query: string | null) {
  return useQuery({
    ...entitySuggestionsQueryOptions(query ?? ''),
    enabled: query !== null,
  });
}
