import type { Entity } from '#models/entities/model.ts';
import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';

export type HypermediaResourceReference = {
  kind: 'entity';
  readableId: string;
};

export interface HypermediaRetrievalMatches {
  pageReadableIds: string[];
  resources: HypermediaResourceReference[];
}

export type HypermediaResource = { kind: 'entity'; entity: Entity };

export type HypermediaResourceContinuation = {
  sharedPageCount: number;
  readableId: string;
};

export type HypermediaResourceNeighbor = {
  resource: HypermediaResource;
  sharedPageCount: number;
};

export type HypermediaResourceNeighborhood = {
  anchor: HypermediaResource;
  neighbors: HypermediaResourceNeighbor[];
  nextPage: HypermediaResourceContinuation | null;
};

export interface HypermediaPage extends KnowledgePageSummary {
  resources: HypermediaResourceReference[];
}

export type HypermediaPages = {
  pages: HypermediaPage[];
  nextOffset: number | null;
  resourceReferencesTruncated: boolean;
};
