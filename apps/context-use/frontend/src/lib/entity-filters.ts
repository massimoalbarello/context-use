import {
  ENTITY_TYPE_FILTERS,
  type EntityTypeFilter,
  MAX_ENTITY_NAME_LENGTH,
} from '#backend/models/entities/model.ts';
import type { PublicationVisibility } from '#backend/models/publications/model.ts';
import type { ResourceStatus } from '#backend/models/resource-archiving/model.ts';
import { resourceStatusSearch } from './resource-status';

export type EntitySearch = {
  q?: string;
  entityType?: EntityTypeFilter;
  status?: ResourceStatus;
  visibility?: PublicationVisibility;
};

export function entitySearch(search: Record<string, unknown>): EntitySearch {
  const entityType = ENTITY_TYPE_FILTERS.find((type) => type === search.entityType);
  return {
    q:
      typeof search.q === 'string'
        ? search.q.trim().slice(0, MAX_ENTITY_NAME_LENGTH) || undefined
        : undefined,
    ...resourceStatusSearch(search),
    entityType: entityType === 'all' ? undefined : entityType,
  };
}
