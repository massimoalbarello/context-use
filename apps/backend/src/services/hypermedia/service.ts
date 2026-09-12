import type {
  HypermediaEntityContinuation,
  HypermediaEntityReference,
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

  entityNeighborhood(input: {
    ownerId: string;
    anchor: HypermediaEntityReference;
    limit: number;
    cursor?: HypermediaEntityContinuation;
  }) {
    return this.hypermedia.entityNeighborhood(input);
  }

  pages(input: {
    ownerId: string;
    entities: HypermediaEntityReference[];
    visibleEntities: HypermediaEntityReference[];
    limit: number;
    offset: number;
    temporalBounds?: TemporalBounds;
  }) {
    return this.hypermedia.pages(input);
  }
}

export type HypermediaServiceContract = Pick<HypermediaService, 'entityNeighborhood' | 'pages'>;
