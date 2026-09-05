import type {
  HypermediaResourceContinuation,
  HypermediaResourceReference,
} from '#models/hypermedia/model.ts';
import type { TemporalBounds } from '#models/knowledge-pages/temporal-coverage.ts';
import type { HypermediaRepositoryContract } from '#repositories/hypermedia/repository.ts';

export class HypermediaService {
  constructor(private readonly hypermedia: HypermediaRepositoryContract) {}

  resourceNeighborhood(input: {
    ownerId: string;
    anchor: HypermediaResourceReference;
    limit: number;
    cursor?: HypermediaResourceContinuation;
  }) {
    return this.hypermedia.resourceNeighborhood(input);
  }

  pages(input: {
    ownerId: string;
    resources: HypermediaResourceReference[];
    limit: number;
    query?: string;
    temporalBounds?: TemporalBounds;
  }) {
    return this.hypermedia.pages(input);
  }
}

export type HypermediaServiceContract = Pick<HypermediaService, 'resourceNeighborhood' | 'pages'>;
