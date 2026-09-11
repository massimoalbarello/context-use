import type {
  HypermediaPageInterval,
  HypermediaResource,
  HypermediaResourceKind,
  HypermediaResourceReference,
} from '#models/hypermedia/model.ts';
import {
  HYPERMEDIA_RESOURCE_TYPES,
  type HypermediaResourceType,
  type HypermediaRetrievalFilters,
  type HypermediaRetrievalResults,
  MAX_HYPERMEDIA_SEARCH_LIMIT,
} from '#models/hypermedia-retrieval/model.ts';
import type { TemporalBounds } from '#models/knowledge-pages/temporal-coverage.ts';
import type { HypermediaRepositoryContract } from '#repositories/hypermedia/repository.ts';
import type { HypermediaRetrievalRepositoryContract } from '#repositories/hypermedia-retrieval/contract.ts';

export class HypermediaRetrievalService {
  constructor(
    private readonly dependencies: {
      retrieval: HypermediaRetrievalRepositoryContract;
      hypermedia: Pick<HypermediaRepositoryContract, 'pages'>;
    },
  ) {}

  search({
    ownerId,
    query,
    resourceTypes = [...HYPERMEDIA_RESOURCE_TYPES],
    limit,
    filters,
  }: {
    ownerId: string;
    query: string;
    resourceTypes?: HypermediaResourceType[];
    limit: number;
    filters?: HypermediaRetrievalFilters;
  }): Promise<HypermediaRetrievalResults> {
    const normalizedQuery = query.trim();
    const boundedLimit = Math.min(Math.max(limit, 1), MAX_HYPERMEDIA_SEARCH_LIMIT);
    if (!normalizedQuery || resourceTypes.length === 0) {
      return Promise.resolve({ results: [], totalMatches: 0, truncated: false });
    }
    return this.dependencies.retrieval.search({
      ownerId,
      query: normalizedQuery,
      resourceTypes: [...new Set(resourceTypes)],
      limit: boundedLimit,
      filters,
    });
  }

  async searchPageView(input: {
    ownerId: string;
    resources: HypermediaResourceReference[];
    visibleResources: HypermediaResourceReference[];
    kinds: HypermediaResourceKind[];
    interval: HypermediaPageInterval;
    limit: number;
    offset: number;
    query: string;
    temporalBounds?: TemporalBounds;
  }) {
    const retrieval = await this.search({
      ownerId: input.ownerId,
      query: input.query,
      resourceTypes: ['knowledge_page', ...input.kinds],
      limit: MAX_HYPERMEDIA_SEARCH_LIMIT,
      filters: {
        knowledgePage: {
          interval: input.interval,
          temporalBounds: input.interval === 'with' ? input.temporalBounds : undefined,
        },
      },
    });
    const matchedResources: HypermediaResource[] = [];
    const pageReadableIds: string[] = [];
    for (const result of retrieval.results) {
      if (result.resourceType === 'entity') {
        matchedResources.push({ kind: 'entity', entity: result.entity });
      } else if (result.resourceType === 'asset') {
        matchedResources.push({ kind: 'asset', asset: result.asset });
      } else if (result.resourceType === 'knowledge_page') {
        pageReadableIds.push(result.knowledgePage.readableId);
      }
    }
    const { query: _query, ...pageInput } = input;
    const pages = await this.dependencies.hypermedia.pages({
      ...pageInput,
      retrievalMatches: {
        pageReadableIds,
        resources: matchedResources.map((resource) => ({
          kind: resource.kind,
          readableId:
            resource.kind === 'entity' ? resource.entity.readableId : resource.asset.readableId,
        })),
      },
    });
    return {
      ...pages,
      matchedResources,
      resourceReferencesTruncated: retrieval.truncated || pages.resourceReferencesTruncated,
    };
  }
}

export type HypermediaRetrievalServiceContract = Pick<
  HypermediaRetrievalService,
  'search' | 'searchPageView'
>;
