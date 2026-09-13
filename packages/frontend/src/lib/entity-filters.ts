import {
  ENTITY_TYPE_FILTERS,
  type EntityTypeFilter,
  MAX_ENTITY_NAME_LENGTH,
} from '@repo/backend/entity';

export type EntitySearch = { q?: string; entityType?: EntityTypeFilter };

export function entitySearch(search: Record<string, unknown>): EntitySearch {
  const entityType = ENTITY_TYPE_FILTERS.find((type) => type === search.entityType);
  return {
    q:
      typeof search.q === 'string'
        ? search.q.trim().slice(0, MAX_ENTITY_NAME_LENGTH) || undefined
        : undefined,
    entityType: entityType === 'all' ? undefined : entityType,
  };
}
