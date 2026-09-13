import type { Entity } from '#backend/models/entities/model.ts';
import type { KnowledgePageSummary } from '#backend/models/knowledge-pages/model.ts';

export type HypermediaEntityReference = Pick<Entity, 'readableId'>;

export type HypermediaEntityContinuation = {
  sharedPageCount: number;
  readableId: string;
};

export type HypermediaEntityNeighbor = {
  entity: Entity;
  sharedPageCount: number;
};

export type HypermediaEntityNeighborhood = {
  anchor: Entity;
  neighbors: HypermediaEntityNeighbor[];
  nextPage: HypermediaEntityContinuation | null;
};

export interface HypermediaPage extends KnowledgePageSummary {
  entities: HypermediaEntityReference[];
}

export type HypermediaPages = {
  pages: HypermediaPage[];
  nextOffset: number | null;
  entityReferencesTruncated: boolean;
};
