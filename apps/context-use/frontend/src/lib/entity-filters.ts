import {
  ENTITY_TYPE_FILTERS,
  type EntityTypeFilter,
  MAX_ENTITY_NAME_LENGTH,
} from '#backend/models/entities/model.ts';

import type { PublicationVisibility } from '#backend/models/publications/model.ts';
import { publicationVisibilityFromSearch } from './publication-visibility';

export type EntitySearch = {
  q?: string;
  entityType?: EntityTypeFilter;
  visibility?: PublicationVisibility;
};

export function entitySearch(search: Record<string, unknown>): EntitySearch {
  const entityType = ENTITY_TYPE_FILTERS.find((type) => type === search.entityType);
  return {
    q:
      typeof search.q === 'string'
        ? search.q.trim().slice(0, MAX_ENTITY_NAME_LENGTH) || undefined
        : undefined,
    visibility: publicationVisibilityFromSearch(search.visibility),
    entityType: entityType === 'all' ? undefined : entityType,
  };
}
