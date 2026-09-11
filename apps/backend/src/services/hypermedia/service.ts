import type {
  HypermediaPageInterval,
  HypermediaResourceContinuation,
  HypermediaResourceKind,
  HypermediaResourceReference,
} from '#models/hypermedia/model.ts';
import type { TemporalBounds } from '#models/knowledge-pages/temporal-coverage.ts';
import type { HypermediaRepositoryContract } from '#repositories/hypermedia/repository.ts';

export class HypermediaService {
  private readonly hypermedia: HypermediaRepositoryContract;

  constructor({
    hypermedia,
  }: {
    hypermedia: HypermediaRepositoryContract;
  }) {
    this.hypermedia = hypermedia;
  }

  resourceNeighborhood(input: {
    ownerId: string;
    anchor: HypermediaResourceReference;
    kinds: HypermediaResourceKind[];
    limit: number;
    cursor?: HypermediaResourceContinuation;
  }) {
    return this.hypermedia.resourceNeighborhood(input);
  }

  pages(input: {
    ownerId: string;
    resources: HypermediaResourceReference[];
    visibleResources: HypermediaResourceReference[];
    kinds: HypermediaResourceKind[];
    interval: HypermediaPageInterval;
    limit: number;
    offset: number;
    temporalBounds?: TemporalBounds;
  }) {
    return this.hypermedia.pages(input);
  }
}

export type HypermediaServiceContract = Pick<HypermediaService, 'resourceNeighborhood' | 'pages'>;
