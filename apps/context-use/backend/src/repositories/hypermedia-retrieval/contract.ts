import type {
  HypermediaResourceType,
  HypermediaRetrievalFilters,
  HypermediaRetrievalResults,
} from '#backend/models/hypermedia-retrieval/model.ts';

export interface HypermediaRetrievalRepositoryContract {
  search(input: {
    ownerId: string;
    query: string;
    resourceTypes: HypermediaResourceType[];
    limit: number;
    filters?: HypermediaRetrievalFilters;
  }): Promise<HypermediaRetrievalResults>;
}
