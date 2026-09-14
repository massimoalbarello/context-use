import { t } from 'elysia';
import type {
  HypermediaEntityContinuation,
  HypermediaEntityReference,
  HypermediaNeighborhoods,
  HypermediaPages,
} from '#backend/models/hypermedia-graph/model.ts';
import {
  MAX_HYPERMEDIA_GRAPH_ANCHORS,
  MAX_HYPERMEDIA_NEIGHBOR_LIMIT,
  MAX_HYPERMEDIA_PAGE_FOCUS_ENTITIES,
  MAX_HYPERMEDIA_PAGE_LIMIT,
} from '#backend/models/hypermedia-graph/model.ts';
import { MAX_TEMPORAL_COVERAGE_LENGTH } from '#backend/models/knowledge-pages/temporal-coverage.ts';
import { isReadableId, MAX_READABLE_ID_LENGTH } from '#backend/models/readable-ids/model.ts';
import { EntitySchema, entityResponse } from '#backend/routes/api/entities/model.ts';
import { ReadableIdSchema } from '#backend/routes/api/model.ts';
import {
  KnowledgePageSummarySchema,
  pageSummaryResponse,
} from '#backend/routes/api/pages/model.ts';

export const DEFAULT_MAP_ENTITY_LIMIT = 16;
export const DEFAULT_MAP_PAGE_LIMIT = 32;
const MAX_MAP_CURSOR_LENGTH = 512;
const MAX_MAP_FOCUS_LENGTH = MAX_HYPERMEDIA_PAGE_FOCUS_ENTITIES * (MAX_READABLE_ID_LENGTH + 1);

const MapEntityReferenceSchema = t.Object({
  readableId: ReadableIdSchema,
});

export const MapNeighborhoodsQuerySchema = t.Object({
  anchors: t.ArrayString(
    t.Object({
      anchor: MapEntityReferenceSchema,
      cursor: t.Optional(t.String({ minLength: 1, maxLength: MAX_MAP_CURSOR_LENGTH })),
    }),
    {
      minItems: 1,
      maxItems: MAX_HYPERMEDIA_GRAPH_ANCHORS,
      description: 'JSON-encoded array of entity anchors and their optional pagination cursors.',
    },
  ),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: MAX_HYPERMEDIA_NEIGHBOR_LIMIT })),
});

export const MapNeighborhoodsSchema = t.Object({
  entities: t.Array(EntitySchema),
  neighborhoods: t.Array(
    t.Object({
      anchor: MapEntityReferenceSchema,
      available: t.Boolean(),
      neighbors: t.Array(
        t.Object({
          entity: MapEntityReferenceSchema,
          sharedPageCount: t.Integer({ minimum: 1 }),
        }),
      ),
      nextCursor: t.Nullable(t.String()),
    }),
  ),
  relationships: t.Array(
    t.Object({
      source: MapEntityReferenceSchema,
      target: MapEntityReferenceSchema,
      sharedPageCount: t.Integer({ minimum: 1 }),
    }),
  ),
  relationshipsTruncated: t.Boolean(),
});

export const MapPagesQuerySchema = t.Object({
  visible: t.Optional(
    t.String({
      minLength: 1,
      maxLength: MAX_MAP_FOCUS_LENGTH,
    }),
  ),
  limit: t.Optional(
    t.Integer({
      minimum: 1,
      maximum: MAX_HYPERMEDIA_PAGE_LIMIT,
      default: DEFAULT_MAP_PAGE_LIMIT,
    }),
  ),
  offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
  time: t.Optional(
    t.String({
      minLength: 1,
      maxLength: MAX_TEMPORAL_COVERAGE_LENGTH,
      description: 'Return pages overlapping this time interval. Omit for undated pages.',
    }),
  ),
});

const MapPageSchema = t.Object({
  ...KnowledgePageSummarySchema.properties,
  entities: t.Array(MapEntityReferenceSchema),
});

export const MapPagesSchema = t.Object({
  pages: t.Array(MapPageSchema),
  nextOffset: t.Nullable(t.Integer({ minimum: 0 })),
  entityReferencesTruncated: t.Boolean(),
});

export function parseMapEntities(value?: string): HypermediaEntityReference[] | null {
  if (value === undefined) {
    return [];
  }
  const references: HypermediaEntityReference[] = [];
  for (const readableId of value.split(',')) {
    if (!isReadableId(readableId)) {
      return null;
    }
    references.push({ readableId });
  }
  return references;
}

export function encodeMapEntityCursor(cursor: HypermediaEntityContinuation | null): string | null {
  return cursor
    ? Buffer.from(JSON.stringify({ version: 1, ...cursor }), 'utf8').toString('base64url')
    : null;
}

export function decodeMapEntityCursor(
  value: string | undefined,
): { state: 'valid'; cursor?: HypermediaEntityContinuation } | { state: 'invalid' } {
  if (value === undefined) {
    return { state: 'valid' };
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) {
      return { state: 'invalid' };
    }
    const payload: unknown = JSON.parse(decoded.toString('utf8'));
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('version' in payload) ||
      payload.version !== 1 ||
      !('sharedPageCount' in payload) ||
      typeof payload.sharedPageCount !== 'number' ||
      !Number.isSafeInteger(payload.sharedPageCount) ||
      payload.sharedPageCount < 1 ||
      !('readableId' in payload) ||
      typeof payload.readableId !== 'string' ||
      !isReadableId(payload.readableId)
    ) {
      return { state: 'invalid' };
    }
    return {
      state: 'valid',
      cursor: {
        sharedPageCount: payload.sharedPageCount,
        readableId: payload.readableId,
      },
    };
  } catch {
    return { state: 'invalid' };
  }
}

export function mapNeighborhoodsResponse(result: HypermediaNeighborhoods) {
  return {
    entities: result.entities.map(entityResponse),
    neighborhoods: result.neighborhoods.map(({ anchor, available, neighbors, nextPage }) => ({
      anchor,
      available,
      neighbors,
      nextCursor: encodeMapEntityCursor(nextPage),
    })),
    relationships: result.relationships,
    relationshipsTruncated: result.relationshipsTruncated,
  };
}

export function mapPagesResponse(result: HypermediaPages) {
  return {
    pages: result.pages.map((page) => ({
      ...pageSummaryResponse(page),
      entities: page.entities,
    })),
    nextOffset: result.nextOffset,
    entityReferencesTruncated: result.entityReferencesTruncated,
  };
}
