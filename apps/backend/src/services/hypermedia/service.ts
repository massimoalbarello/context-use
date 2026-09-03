import type {
  HypermediaPageContinuation,
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

  focusedPages(input: {
    ownerId: string;
    resources: HypermediaResourceReference[];
    limit: number;
    cursor?: HypermediaPageContinuation;
    query?: string;
    temporalBounds?: TemporalBounds;
    retainPageReadableId?: string;
  }) {
    return this.hypermedia.focusedPages(input);
  }
}

export type HypermediaServiceContract = Pick<
  HypermediaService,
  'resourceNeighborhood' | 'focusedPages'
>;
