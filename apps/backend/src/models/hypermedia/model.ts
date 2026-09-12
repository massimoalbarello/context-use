import type { AssetSummary } from '#models/assets/model.ts';
import type { Entity } from '#models/entities/model.ts';
import type {
  KnowledgePageIntervalFilter,
  KnowledgePageSummary,
} from '#models/knowledge-pages/model.ts';

export type HypermediaResourceKind = 'entity' | 'asset';
export type HypermediaPageInterval = KnowledgePageIntervalFilter;

export type HypermediaResourceReference = {
  kind: HypermediaResourceKind;
  readableId: string;
};

export interface HypermediaRetrievalMatches {
  pageReadableIds: string[];
  resources: HypermediaResourceReference[];
}

export type HypermediaResource =
  | { kind: 'entity'; entity: Entity }
  | { kind: 'asset'; asset: AssetSummary };

export type HypermediaResourceContinuation = {
  sharedPageCount: number;
  kind: HypermediaResourceKind;
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
