import type {
  HypermediaAnchorRequest,
  HypermediaEntityReference,
  HypermediaNeighborhoods,
  HypermediaPages,
  HypermediaRetrievalMatches,
} from '#models/hypermedia-graph/model.ts';
import type { TemporalBounds } from '#models/knowledge-pages/temporal-coverage.ts';

export interface HypermediaGraphRepositoryContract {
  neighborhoods(input: {
    ownerId: string;
    anchors: HypermediaAnchorRequest[];
    limit: number;
  }): Promise<HypermediaNeighborhoods>;
  pages(input: {
    ownerId: string;
    entities: HypermediaEntityReference[];
    visibleEntities: HypermediaEntityReference[];
    limit: number;
    offset: number;
    retrievalMatches?: HypermediaRetrievalMatches;
    temporalBounds?: TemporalBounds;
  }): Promise<HypermediaPages>;
}
