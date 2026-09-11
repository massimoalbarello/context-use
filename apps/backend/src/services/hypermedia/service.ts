import type {
  HypermediaPageInterval,
  HypermediaResourceContinuation,
  HypermediaResourceKind,
  HypermediaResourceReference,
} from '#models/hypermedia/model.ts';
import { MAX_HYPERMEDIA_SEARCH_LIMIT } from '#models/hypermedia-retrieval/model.ts';
import type { TemporalBounds } from '#models/knowledge-pages/temporal-coverage.ts';
import type { HypermediaRepositoryContract } from '#repositories/hypermedia/repository.ts';
import type { HypermediaRetrievalRepositoryContract } from '#repositories/hypermedia-retrieval/contract.ts';

export class HypermediaService {
  private readonly hypermedia: HypermediaRepositoryContract;
  private readonly retrieval: Pick<HypermediaRetrievalRepositoryContract, 'search'>;

  constructor({
    hypermedia,
    retrieval,
  }: {
    hypermedia: HypermediaRepositoryContract;
    retrieval: Pick<HypermediaRetrievalRepositoryContract, 'search'>;
  }) {
    this.hypermedia = hypermedia;
    this.retrieval = retrieval;
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

  async pages(input: {
    ownerId: string;
    resources: HypermediaResourceReference[];
    visibleResources: HypermediaResourceReference[];
    kinds: HypermediaResourceKind[];
    interval: HypermediaPageInterval;
    limit: number;
    offset: number;
    query?: string;
    temporalBounds?: TemporalBounds;
  }) {
    const query = input.query?.trim();
    if (!query) {
      return this.hypermedia.pages(input);
    }
    const retrieval = await this.retrieval.search({
      ownerId: input.ownerId,
      query,
      resourceTypes: ['knowledge_page', ...input.kinds],
      limit: MAX_HYPERMEDIA_SEARCH_LIMIT,
      filters: {
        knowledgePage: {
          interval: input.interval,
          temporalBounds: input.interval === 'with' ? input.temporalBounds : undefined,
        },
      },
    });
    const matchedResources: HypermediaResourceReference[] = [];
    for (const result of retrieval.results) {
      if (result.resourceType === 'entity') {
        matchedResources.push({ kind: 'entity', readableId: result.entity.readableId });
      } else if (result.resourceType === 'asset') {
        matchedResources.push({ kind: 'asset', readableId: result.asset.readableId });
      }
    }
    const { query: _query, ...pageInput } = input;
    const pages = await this.hypermedia.pages({
      ...pageInput,
      retrievalMatches: {
        pageReadableIds: retrieval.results.flatMap((result) =>
          result.resourceType === 'knowledge_page' ? [result.knowledgePage.readableId] : [],
        ),
        resources: matchedResources,
      },
    });
    return {
      ...pages,
      resourceReferencesTruncated: retrieval.truncated || pages.resourceReferencesTruncated,
    };
  }
}

export type HypermediaServiceContract = Pick<HypermediaService, 'resourceNeighborhood' | 'pages'>;
