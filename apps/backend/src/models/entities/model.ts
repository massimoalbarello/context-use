import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';

export const MAX_ENTITY_NAME_LENGTH = 160;
export const MIN_ENTITY_DESCRIPTION_LENGTH = 1;
export const MAX_ENTITY_DESCRIPTION_LENGTH = 600;

export interface Entity {
  id: string;
  readableId: string;
  name: string;
  description: string;
  isSelf: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EntityDetail extends Entity {
  pages: KnowledgePageSummary[];
}
