import type { KnowledgePageSummary } from '#pages/knowledge-page.ts';

export const MAX_ENTITY_NAME_LENGTH = 160;
export const MIN_ENTITY_DESCRIPTION_LENGTH = 20;
export const MAX_ENTITY_DESCRIPTION_LENGTH = 600;

export interface Entity {
  id: string;
  readableId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntityDetail extends Entity {
  pages: KnowledgePageSummary[];
}

export interface EntityRepositoryContract {
  create(input: {
    id: string;
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
    createdAt: string;
  }): Promise<{ state: 'created'; entity: Entity } | { state: 'readable_id_conflict' }>;
  list(input: { ownerId: string }): Promise<Entity[]>;
  find(input: { ownerId: string; readableId: string }): Promise<Entity | null>;
  update(input: {
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
    updatedAt: string;
  }): Promise<Entity | null>;
}
