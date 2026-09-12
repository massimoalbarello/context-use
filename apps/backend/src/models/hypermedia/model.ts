import type { Entity } from '#models/entities/model.ts';
import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';

export type HypermediaEntityReference = Pick<Entity, 'readableId'>;

export interface HypermediaRetrievalMatches {
  pageReadableIds: string[];
  entities: HypermediaEntityReference[];
}

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
