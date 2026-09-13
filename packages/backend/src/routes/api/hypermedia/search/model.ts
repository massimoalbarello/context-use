import { t } from 'elysia';
import {
  DEFAULT_HYPERMEDIA_SEARCH_LIMIT,
  HYPERMEDIA_RESOURCE_TYPES,
  type HypermediaRetrievalResult,
  MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH,
  MAX_HYPERMEDIA_SEARCH_LIMIT,
  MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH,
} from '#models/hypermedia-retrieval/model.ts';
import { MAX_TEMPORAL_COVERAGE_LENGTH } from '#models/knowledge-pages/temporal-coverage.ts';
import {
  assetAddress,
  entityAddress,
  pageAddress,
  recordAddress,
} from '#models/readable-ids/addresses.ts';
import { AssetSummarySchema, assetSummaryResponse } from '#routes/api/assets/summary-model.ts';
import {
  EntitySchema,
  EntityTypeFilterSchema,
  entityResponse,
} from '#routes/api/entities/model.ts';
import { KnowledgePageSummarySchema, pageSummaryResponse } from '#routes/api/pages/model.ts';
import {
  RecordListQuerySchema,
  RecordSummarySchema,
  recordSummaryResponse,
} from '#routes/api/records/model.ts';

const RecordFilterValueSchema = t.Optional(
  t.String({
    minLength: 1,
    maxLength: MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH,
    pattern: '\\S',
  }),
);

export const HypermediaSearchQuerySchema = t.Object({
  entityType: t.Optional(EntityTypeFilterSchema),
  query: t.String({ minLength: 1, maxLength: MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH, pattern: '\\S' }),
  resourceTypes: t.Optional(
    t.String({
      maxLength: HYPERMEDIA_RESOURCE_TYPES.join(',').length,
      pattern: `^(?:${HYPERMEDIA_RESOURCE_TYPES.join('|')})(?:,(?:${HYPERMEDIA_RESOURCE_TYPES.join('|')}))*$`,
    }),
  ),
  limit: t.Optional(
    t.Integer({
      minimum: 1,
      maximum: MAX_HYPERMEDIA_SEARCH_LIMIT,
      default: DEFAULT_HYPERMEDIA_SEARCH_LIMIT,
    }),
  ),
  interval: t.Optional(t.Union([t.Literal('with'), t.Literal('without')])),
  time: t.Optional(t.String({ minLength: 1, maxLength: MAX_TEMPORAL_COVERAGE_LENGTH })),
  assetKind: t.Optional(t.Literal('entity_image')),
  recordProvider: RecordFilterValueSchema,
  recordKind: RecordFilterValueSchema,
  participantName: RecordFilterValueSchema,
  recordCreatedFrom: RecordListQuerySchema.properties.createdFrom,
  recordCreatedTo: RecordListQuerySchema.properties.createdTo,
  recordUpdatedFrom: RecordListQuerySchema.properties.updatedFrom,
  recordUpdatedTo: RecordListQuerySchema.properties.updatedTo,
});

const PreviewProperties = {
  address: t.String(),
  matchExcerpt: t.Nullable(t.String({ maxLength: MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH })),
};

export const HypermediaSearchSchema = t.Object({
  results: t.Array(
    t.Union([
      t.Object({ ...PreviewProperties, resourceType: t.Literal('entity'), entity: EntitySchema }),
      t.Object({
        ...PreviewProperties,
        resourceType: t.Literal('knowledge_page'),
        knowledgePage: KnowledgePageSummarySchema,
      }),
      t.Object({
        ...PreviewProperties,
        resourceType: t.Literal('asset'),
        asset: AssetSummarySchema,
      }),
      t.Object({
        ...PreviewProperties,
        resourceType: t.Literal('record'),
        record: t.Object({
          ...RecordSummarySchema.properties,
          participantNames: t.Array(t.String()),
        }),
      }),
    ]),
  ),
  totalMatches: t.Integer({ minimum: 0 }),
  truncated: t.Boolean(),
});

export function hypermediaSearchResultResponse(result: HypermediaRetrievalResult) {
  const preview = { matchExcerpt: result.matchExcerpt };
  switch (result.resourceType) {
    case 'entity':
      return {
        ...preview,
        resourceType: result.resourceType,
        address: entityAddress(result.entity.readableId),
        entity: entityResponse(result.entity),
      };
    case 'knowledge_page':
      return {
        ...preview,
        resourceType: result.resourceType,
        address: pageAddress(result.knowledgePage.readableId),
        knowledgePage: pageSummaryResponse(result.knowledgePage),
      };
    case 'asset':
      return {
        ...preview,
        resourceType: result.resourceType,
        address: assetAddress(result.asset.readableId),
        asset: assetSummaryResponse(result.asset),
      };
    case 'record':
      return {
        ...preview,
        resourceType: result.resourceType,
        address: recordAddress(result.record.readableId),
        record: {
          ...recordSummaryResponse(result.record),
          participantNames: result.record.participantNames,
        },
      };
  }
}
