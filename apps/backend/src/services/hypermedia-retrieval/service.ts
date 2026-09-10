import {
  HYPERMEDIA_RESOURCE_TYPES,
  type HypermediaResourceType,
  type HypermediaRetrievalFilters,
  type HypermediaRetrievalResults,
  MAX_HYPERMEDIA_SEARCH_LIMIT,
} from '#models/hypermedia-retrieval/model.ts';
import type { HypermediaRetrievalRepositoryContract } from '#repositories/hypermedia-retrieval/contract.ts';

export class HypermediaRetrievalService {
  constructor(private readonly retrieval: Pick<HypermediaRetrievalRepositoryContract, 'search'>) {}

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
    return this.retrieval.search({
      ownerId,
      query: normalizedQuery,
      resourceTypes: [...new Set(resourceTypes)],
      limit: boundedLimit,
      filters,
    });
  }
}

export type HypermediaRetrievalServiceContract = Pick<HypermediaRetrievalService, 'search'>;
