import type { AssetSummary } from '#models/assets/model.ts';
import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';

export const MAX_ENTITY_NAME_LENGTH = 160;
export const MIN_ENTITY_DESCRIPTION_LENGTH = 1;
export const MAX_ENTITY_DESCRIPTION_LENGTH = 600;

export const ENTITY_TYPES = ['person', 'organization', 'location'] as const;
export const SELF_ENTITY_TYPE = 'person' satisfies (typeof ENTITY_TYPES)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];
export const ENTITY_TYPE_FILTERS = ['all', ...ENTITY_TYPES, 'untyped'] as const;
export type EntityTypeFilter = (typeof ENTITY_TYPE_FILTERS)[number];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  person: 'Person',
  organization: 'Organization',
  location: 'Location',
};

export const ENTITY_TYPE_FILTER_LABELS: Record<EntityTypeFilter, string> = {
  all: 'All',
  person: 'People',
  organization: 'Organizations',
  location: 'Locations',
  untyped: 'Untyped',
};

export const ENTITY_TYPE_DESCRIPTION =
  'Person: a specific individual. Organization: an identifiable collective, including companies, restaurants, institutions, and named teams. Location: a specific geographic referent, such as a building, address, city, or region. Leave untyped when unsupported or uncertain. Assign from contextual evidence, not a name alone. Events are temporal pages mentioning entities. The self entity is always a Person; its type cannot be changed or cleared.';

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
