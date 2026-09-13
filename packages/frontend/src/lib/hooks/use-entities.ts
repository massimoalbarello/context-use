import type { EntityTypeFilter } from '@repo/backend/entity';
import { useInfiniteQuery } from '@tanstack/react-query';
import { entitiesQueryOptions } from '../../queries/entities';

export function useEntities({
  enabled = true,
  query,
  entityType,
}: {
  enabled?: boolean;
  query?: string;
  entityType?: EntityTypeFilter;
} = {}) {
  const result = useInfiniteQuery({ ...entitiesQueryOptions({ query, entityType }), enabled });

  return {
    ...result,
    entities: result.data?.pages.flatMap((page) => page.items) ?? [],
    total: result.data?.pages[0]?.total ?? 0,
  };
}
