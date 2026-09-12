import {
  type HypermediaAnchorRequest,
  InvalidHypermediaNeighborhoodsError,
  MAX_HYPERMEDIA_GRAPH_ANCHORS,
  MAX_HYPERMEDIA_NEIGHBOR_LIMIT,
} from '#models/hypermedia-graph/model.ts';
import type { HypermediaGraphRepositoryContract } from '#repositories/hypermedia-graph/contract.ts';

export class HypermediaGraphService {
  constructor(private readonly dependencies: { graph: HypermediaGraphRepositoryContract }) {}

  neighborhoods(input: { ownerId: string; anchors: HypermediaAnchorRequest[]; limit: number }) {
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

  pages(input: Parameters<HypermediaGraphRepositoryContract['pages']>[0]) {
    return this.dependencies.graph.pages(input);
  }
}

export type HypermediaGraphServiceContract = Pick<
  HypermediaGraphService,
  'neighborhoods' | 'pages'
>;
