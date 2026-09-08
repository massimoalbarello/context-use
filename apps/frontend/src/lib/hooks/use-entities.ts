import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { entitiesQueryOptions, entitySuggestionsQueryOptions } from '../../queries/entities';

export function useEntities({ enabled = true }: { enabled?: boolean } = {}) {
  const query = useInfiniteQuery({ ...entitiesQueryOptions, enabled });

  return {
    ...query,
    entities: query.data?.pages.flatMap((page) => page.items) ?? [],
    total: query.data?.pages[0]?.total ?? 0,
  };
}

export function useEntitySuggestions(query: string | null) {
  return useQuery({
    ...entitySuggestionsQueryOptions(query ?? ''),
    enabled: query !== null,
  });
}
