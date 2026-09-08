import type {
  HypermediaResourceType,
  HypermediaRetrievalFilters,
  HypermediaRetrievalResults,
} from '#models/hypermedia-retrieval/model.ts';

export interface HypermediaRetrievalRepositoryContract {
  search(input: {
    ownerId: string;
    query: string;
    resourceTypes: HypermediaResourceType[];
    limit: number;
    filters?: HypermediaRetrievalFilters;
  }): Promise<HypermediaRetrievalResults>;
  rebuildIndex(): Promise<void>;
}
