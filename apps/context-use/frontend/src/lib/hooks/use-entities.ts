import { useInfiniteQuery } from '@tanstack/react-query';
import type { EntityTypeFilter } from '#backend/models/entities/model.ts';
import type { PublicationVisibility } from '#backend/models/publications/model.ts';
import { entitiesQueryOptions } from '../../queries/entities';

export function useEntities({
  enabled = true,
  query,
  entityType,
  visibility,
}: {
  enabled?: boolean;
  query?: string;
  entityType?: EntityTypeFilter;
  visibility?: PublicationVisibility;
} = {}) {
  const result = useInfiniteQuery({
    ...entitiesQueryOptions({ query, entityType, visibility }),
    enabled,
  });

  return {
    ...result,
    entities: result.data?.pages.flatMap((page) => page.items) ?? [],
    total: result.data?.pages[0]?.total ?? 0,
  };
}
