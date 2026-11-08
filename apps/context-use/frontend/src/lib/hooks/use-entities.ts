import { useInfiniteQuery } from '@tanstack/react-query';
import type { EntityTypeFilter } from '#backend/models/entities/model.ts';
import type { PublicationVisibility } from '#backend/models/publications/model.ts';
import type { ResourceStatus } from '#backend/models/resource-archiving/model.ts';
import { entitiesQueryOptions } from '../../queries/entities';

export function useEntities({
  enabled = true,
  query,
  entityType,
  status,
  visibility,
}: {
  enabled?: boolean;
  query?: string;
  entityType?: EntityTypeFilter;
  status?: ResourceStatus;
  visibility?: PublicationVisibility;
} = {}) {
  const result = useInfiniteQuery({
    ...entitiesQueryOptions({ query, entityType, status, visibility }),
    enabled,
  });

  return {
    ...result,
    entities: result.data?.pages.flatMap((page) => page.items) ?? [],
    total: result.data?.pages[0]?.total ?? 0,
  };
}
