import type {
  HypermediaAnchorRequest,
  HypermediaEntityReference,
  HypermediaNeighborhoods,
  HypermediaPages,
} from '#backend/models/hypermedia-graph/model.ts';
import type { TemporalBounds } from '#backend/models/knowledge-pages/temporal-coverage.ts';

export interface HypermediaGraphRepositoryContract {
  neighborhoods(input: {
    ownerId: string;
    anchors: HypermediaAnchorRequest[];
    limit: number;
  }): Promise<HypermediaNeighborhoods>;
  pages(input: {
    ownerId: string;
    visibleEntities: HypermediaEntityReference[];
    limit: number;
    offset: number;
    temporalBounds?: TemporalBounds;
  }): Promise<HypermediaPages>;
}
