import type { Entity } from '#models/entities/model.ts';
import type { HypermediaEntityReference } from '#models/hypermedia-graph/model.ts';
import {
  HYPERMEDIA_RESOURCE_TYPES,
  type HypermediaResourceType,
  type HypermediaRetrievalFilters,
  type HypermediaRetrievalResults,
  MAX_HYPERMEDIA_SEARCH_LIMIT,
} from '#models/hypermedia-retrieval/model.ts';
import type { TemporalBounds } from '#models/knowledge-pages/temporal-coverage.ts';
import type { HypermediaRetrievalRepositoryContract } from '#repositories/hypermedia-retrieval/contract.ts';
import type { HypermediaGraphServiceContract } from '#services/hypermedia-graph/service.ts';

export class HypermediaRetrievalService {
  constructor(
    private readonly dependencies: {
      retrieval: HypermediaRetrievalRepositoryContract;
      graph: Pick<HypermediaGraphServiceContract, 'pages'>;
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
    entities: HypermediaEntityReference[];
    visibleEntities: HypermediaEntityReference[];
    limit: number;
    offset: number;
    query: string;
    temporalBounds?: TemporalBounds;
  }) {
    const retrieval = await this.search({
      ownerId: input.ownerId,
      query: input.query,
      resourceTypes: ['knowledge_page', 'entity'],
      limit: MAX_HYPERMEDIA_SEARCH_LIMIT,
      filters: {
        knowledgePage: {
          interval: input.temporalBounds ? undefined : 'without',
          temporalBounds: input.temporalBounds,
        },
      },
    });
    const matchedEntities: Entity[] = [];
    const pageReadableIds: string[] = [];
    for (const result of retrieval.results) {
      if (result.resourceType === 'entity') {
        matchedEntities.push(result.entity);
      } else if (result.resourceType === 'knowledge_page') {
        pageReadableIds.push(result.knowledgePage.readableId);
      }
    }
    const { query: _query, ...pageInput } = input;
    const pages = await this.dependencies.graph.pages({
      ...pageInput,
      retrievalMatches: {
        pageReadableIds,
        entities: matchedEntities.map((entity) => ({
          readableId: entity.readableId,
        })),
      },
    });
    return {
      ...pages,
      matchedEntities,
      entityReferencesTruncated: retrieval.truncated || pages.entityReferencesTruncated,
    };
  }
}

export type HypermediaRetrievalServiceContract = Pick<
  HypermediaRetrievalService,
  'search' | 'searchPageView'
>;
