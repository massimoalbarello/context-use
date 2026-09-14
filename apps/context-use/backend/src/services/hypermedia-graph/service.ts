import {
  type HypermediaAnchorRequest,
  type HypermediaEntityReference,
  type HypermediaNeighborhoods,
  type HypermediaPages,
  InvalidHypermediaNeighborhoodsError,
  InvalidHypermediaPagesError,
  MAX_HYPERMEDIA_GRAPH_ANCHORS,
  MAX_HYPERMEDIA_NEIGHBOR_LIMIT,
  MAX_HYPERMEDIA_PAGE_FOCUS_ENTITIES,
  MAX_HYPERMEDIA_PAGE_LIMIT,
} from '#backend/models/hypermedia-graph/model.ts';
import type { TemporalBounds } from '#backend/models/knowledge-pages/temporal-coverage.ts';
import type { HypermediaGraphRepositoryContract } from '#backend/repositories/hypermedia-graph/contract.ts';

export class HypermediaGraphService {
  constructor(private readonly dependencies: { graph: HypermediaGraphRepositoryContract }) {}

  neighborhoods(input: {
    ownerId: string;
    anchors: HypermediaAnchorRequest[];
    limit: number;
  }): Promise<HypermediaNeighborhoods> {
    if (
      input.anchors.length === 0 ||
      input.anchors.length > MAX_HYPERMEDIA_GRAPH_ANCHORS ||
      new Set(input.anchors.map(({ anchor }) => anchor.readableId)).size !== input.anchors.length ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAX_HYPERMEDIA_NEIGHBOR_LIMIT
    ) {
      throw new InvalidHypermediaNeighborhoodsError(
        'Invalid or duplicate neighborhood anchors or limit',
      );
    }
    return this.dependencies.graph.neighborhoods(input);
  }

  pages(input: {
    ownerId: string;
    visibleEntities: HypermediaEntityReference[];
    limit: number;
    offset: number;
    temporalBounds?: TemporalBounds;
  }): Promise<HypermediaPages> {
    if (
      input.visibleEntities.length > MAX_HYPERMEDIA_PAGE_FOCUS_ENTITIES ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAX_HYPERMEDIA_PAGE_LIMIT ||
      !Number.isSafeInteger(input.offset) ||
      input.offset < 0
    ) {
      throw new InvalidHypermediaPagesError('Invalid page focus, limit or offset');
    }
    const visibleEntities = new Map(
      input.visibleEntities.map((entity) => [entity.readableId, entity]),
    );
    return this.dependencies.graph.pages({
      ...input,
      visibleEntities: [...visibleEntities.values()],
    });
  }
}

export type HypermediaGraphServiceContract = Pick<
  HypermediaGraphService,
  'neighborhoods' | 'pages'
>;
