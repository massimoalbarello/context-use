import type { AssetSummary } from '#models/assets/model.ts';
import type { Entity, EntityTypeFilter } from '#models/entities/model.ts';
import type {
  KnowledgePageIntervalFilter,
  KnowledgePageSummary,
} from '#models/knowledge-pages/model.ts';
import type { TemporalBounds } from '#models/knowledge-pages/temporal-coverage.ts';
import type { RecordSourceFilters, RecordSummary } from '#models/records/model.ts';

export const HYPERMEDIA_RESOURCE_TYPES = ['entity', 'knowledge_page', 'asset', 'record'] as const;
export const DEFAULT_HYPERMEDIA_SEARCH_LIMIT = 30;
export const MAX_HYPERMEDIA_SEARCH_LIMIT = 50;
export const MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH = 1_000;
export const MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH = 480;

export type HypermediaResourceType = (typeof HYPERMEDIA_RESOURCE_TYPES)[number];

export type HypermediaRetrievalResult =
  | {
      resourceType: 'entity';
      entity: Entity;
      matchExcerpt: string | null;
    }
  | {
      resourceType: 'knowledge_page';
      knowledgePage: KnowledgePageSummary;
      matchExcerpt: string | null;
    }
  | {
      resourceType: 'asset';
      asset: AssetSummary;
      matchExcerpt: string | null;
    }
  | {
      resourceType: 'record';
      record: RecordSummary & { participantNames: string[] };
      matchExcerpt: string | null;
    };

export interface HypermediaRetrievalResults {
  results: HypermediaRetrievalResult[];
  totalMatches: number;
  truncated: boolean;
}

export interface HypermediaRetrievalFilters {
  /** When present, restrict retrieval to entities with the selected type. */
  entityType?: EntityTypeFilter;
  knowledgePage?: {
    interval?: KnowledgePageIntervalFilter;
    temporalBounds?: TemporalBounds;
  };
  asset?: { kind?: 'entity_image' };
  /** When present, restrict retrieval to records satisfying every supplied field. */
  record?: RecordSourceFilters & { participantName?: string };
}
