import type { Entity } from '#backend/models/entities/model.ts';
import type { KnowledgePageSummary } from '#backend/models/knowledge-pages/model.ts';

export type HypermediaEntityReference = Pick<Entity, 'readableId'>;

export type HypermediaEntityContinuation = {
  sharedPageCount: number;
  readableId: string;
};

export const MAX_HYPERMEDIA_GRAPH_ANCHORS = 8;
export const MAX_HYPERMEDIA_NEIGHBOR_LIMIT = 24;
export const MAX_HYPERMEDIA_EXTRA_RELATIONSHIPS = 512;
export const MAX_HYPERMEDIA_PAGE_LIMIT = 32;
export const MAX_HYPERMEDIA_PAGE_FOCUS_ENTITIES = 24;

export class InvalidHypermediaNeighborhoodsError extends Error {}
export class InvalidHypermediaPagesError extends Error {}

export type HypermediaAnchorRequest = {
  anchor: HypermediaEntityReference;
  cursor?: HypermediaEntityContinuation;
};

export type HypermediaEntityNeighbor = {
  entity: HypermediaEntityReference;
  sharedPageCount: number;
};

export type HypermediaEntityNeighborhood = {
  anchor: HypermediaEntityReference;
  available: boolean;
  neighbors: HypermediaEntityNeighbor[];
  nextPage: HypermediaEntityContinuation | null;
};

export type HypermediaRelationship = {
  source: HypermediaEntityReference;
  target: HypermediaEntityReference;
  sharedPageCount: number;
};

export type HypermediaNeighborhoods = {
  entities: Entity[];
  neighborhoods: HypermediaEntityNeighborhood[];
  relationships: HypermediaRelationship[];
  relationshipsTruncated: boolean;
};

export interface HypermediaPage extends KnowledgePageSummary {
  entities: HypermediaEntityReference[];
}

export type HypermediaPages = {
  pages: HypermediaPage[];
  nextOffset: number | null;
  entityReferencesTruncated: boolean;
};
