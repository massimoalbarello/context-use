import type { AssetSummary } from '#models/assets/model.ts';
import type { Entity } from '#models/entities/model.ts';
import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';

export type HypermediaResourceKind = 'entity' | 'asset';

export type HypermediaResourceReference = {
  kind: HypermediaResourceKind;
  readableId: string;
};

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

export type HypermediaTemporalExtent = {
  start: number;
  end: number;
};

export type HypermediaPages = {
  pages: HypermediaPage[];
  hasMore: boolean;
  temporalExtent: HypermediaTemporalExtent | null;
};
