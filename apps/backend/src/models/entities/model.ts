import type { AssetSummary } from '#models/assets/model.ts';
import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';

export const MAX_ENTITY_NAME_LENGTH = 160;
export const MIN_ENTITY_DESCRIPTION_LENGTH = 1;
export const MAX_ENTITY_DESCRIPTION_LENGTH = 600;

export const ENTITY_TYPES = ['person', 'organization', 'place'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export const ENTITY_TYPE_FILTERS = ['all', ...ENTITY_TYPES, 'untyped'] as const;
export type EntityTypeFilter = (typeof ENTITY_TYPE_FILTERS)[number];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  person: 'Person',
  organization: 'Organization',
  place: 'Place',
};

export const ENTITY_TYPE_FILTER_LABELS: Record<EntityTypeFilter, string> = {
  all: 'All',
  person: 'People',
  organization: 'Organizations',
  place: 'Places',
  untyped: 'Untyped',
};

export const ENTITY_TYPE_DESCRIPTION =
  'Person: a specific individual. Organization: an identifiable collective, including companies, restaurants, institutions, and named teams. Place: a specific geographic referent, such as a building, address, city, or region. Leave untyped when unsupported or uncertain. Assign from contextual evidence, not a name alone. Events are temporal pages mentioning entities.';

export interface Entity {
  id: string;
  readableId: string;
  name: string;
  description: string;
  entityType: EntityType | null;
  isSelf: boolean;
  image: AssetSummary | null;
  createdAt: string;
  updatedAt: string;
}

export type EntityReference = Pick<
  Entity,
  'id' | 'readableId' | 'name' | 'description' | 'entityType' | 'isSelf'
>;

export interface EntityDetail extends Entity {
  pages: KnowledgePageSummary[];
}
