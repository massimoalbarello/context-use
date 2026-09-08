import { z } from 'zod';
import {
  HYPERMEDIA_RESOURCE_TYPES,
  type HypermediaRetrievalResult,
  MAX_HYPERMEDIA_SEARCH_LIMIT,
  MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH,
} from '#models/hypermedia-retrieval/model.ts';
import { MAX_TEMPORAL_COVERAGE_LENGTH } from '#models/knowledge-pages/temporal-coverage.ts';
import {
  AssetAddressSchema,
  assetAddress,
  EntityAddressSchema,
  entityAddress,
  McpReadableIdSchema,
  PageAddressSchema,
  pageAddress,
} from '#routes/mcp/coordinates.ts';

export const SearchHypermediaInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH)
    .regex(/.*\S.*/)
    .describe('Names, aliases, identifiers, or topic phrases to retrieve'),
  resourceTypes: z
    .array(z.enum(HYPERMEDIA_RESOURCE_TYPES))
    .min(1)
    .max(HYPERMEDIA_RESOURCE_TYPES.length)
    .optional()
    .describe('Optional typed resource filter; omit to search every hypermedia resource type'),
  limit: z.number().int().min(1).max(MAX_HYPERMEDIA_SEARCH_LIMIT).optional(),
});

const MatchExcerptSchema = z
  .string()
  .nullable()
  .describe('Query-centered page-body evidence when the match occurred beyond the preview fields');

const EntityResultSchema = z.object({
  resourceType: z.literal('entity'),
  address: EntityAddressSchema,
  readableId: McpReadableIdSchema,
  name: z.string(),
  description: z.string(),
  matchExcerpt: MatchExcerptSchema,
});

const KnowledgePageResultSchema = z.object({
  resourceType: z.literal('knowledge_page'),
  address: PageAddressSchema,
  readableId: McpReadableIdSchema,
  title: z.string(),
  excerpt: z.string(),
  temporalCoverage: z.string().max(MAX_TEMPORAL_COVERAGE_LENGTH).nullable(),
  matchExcerpt: MatchExcerptSchema,
});

const AssetResultSchema = z.object({
  resourceType: z.literal('asset'),
  address: AssetAddressSchema,
  readableId: McpReadableIdSchema,
  name: z.string(),
  mediaType: z.string(),
  extension: z.string().nullable(),
  matchExcerpt: MatchExcerptSchema,
});

export const SearchHypermediaOutputSchema = z.object({
  results: z.array(
    z.discriminatedUnion('resourceType', [
      EntityResultSchema,
      KnowledgePageResultSchema,
      AssetResultSchema,
    ]),
  ),
  truncated: z.boolean(),
});

export function mcpHypermediaRetrievalResult(result: HypermediaRetrievalResult) {
  if (result.resourceType === 'entity') {
    return {
      resourceType: result.resourceType,
      address: entityAddress(result.entity.readableId),
      readableId: result.entity.readableId,
      name: result.entity.name,
      description: result.entity.description,
      matchExcerpt: result.matchExcerpt,
    };
  }
  if (result.resourceType === 'knowledge_page') {
    return {
      resourceType: result.resourceType,
      address: pageAddress(result.knowledgePage.readableId),
      readableId: result.knowledgePage.readableId,
      title: result.knowledgePage.title,
      excerpt: result.knowledgePage.excerpt,
      temporalCoverage: result.knowledgePage.temporalCoverage,
      matchExcerpt: result.matchExcerpt,
    };
  }
  return {
    resourceType: result.resourceType,
    address: assetAddress(result.asset.readableId),
    readableId: result.asset.readableId,
    name: result.asset.name,
    mediaType: result.asset.mediaType,
    extension: result.asset.extension,
    matchExcerpt: result.matchExcerpt,
  };
}
