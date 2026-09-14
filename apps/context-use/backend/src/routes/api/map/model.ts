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
} from '#backend/models/hypermedia-graph/model.ts';
import { MAX_TEMPORAL_COVERAGE_LENGTH } from '#backend/models/knowledge-pages/temporal-coverage.ts';
import { MAX_READABLE_ID_LENGTH, READABLE_ID_PATTERN } from '#backend/models/readable-ids/model.ts';
import { EntitySchema, entityResponse } from '#backend/routes/api/entities/model.ts';
import { PaginationQuerySchema, ReadableIdSchema } from '#backend/routes/api/model.ts';
import {
  KnowledgePageSummarySchema,
  pageSummaryResponse,
} from '#backend/routes/api/pages/model.ts';

export const DEFAULT_MAP_ENTITY_LIMIT = 16;
export const DEFAULT_MAP_PAGE_LIMIT = 32;
export const MAX_MAP_PAGE_LIMIT = 32;
export const MAX_MAP_PAGE_FOCUS_ENTITIES = 24;
const MAX_MAP_CURSOR_LENGTH = 512;
const MAX_MAP_FOCUS_LENGTH = MAX_MAP_PAGE_FOCUS_ENTITIES * (MAX_READABLE_ID_LENGTH + 1);

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
    t.Numeric({
      minimum: 1,
      maximum: MAX_MAP_PAGE_LIMIT,
      default: DEFAULT_MAP_PAGE_LIMIT,
    }),
  ),
  offset: PaginationQuerySchema.properties.offset,
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

export function parseMapEntityReference(value: string): HypermediaEntityReference | null {
  return validReadableId(value) ? { readableId: value } : null;
}

export function parseMapEntities(value?: string): HypermediaEntityReference[] | null {
  if (value === undefined) {
    return [];
  }
  const references = value.split(',').map(parseMapEntityReference);
  if (
    references.length === 0 ||
    references.length > MAX_MAP_PAGE_FOCUS_ENTITIES ||
    references.some((reference) => reference === null)
  ) {
    return null;
  }
  const unique = new Map(references.map((reference) => [reference!.readableId, reference!]));
  return [...unique.values()];
}

function encodedCursor(value: object | null): string | null {
  return value
    ? Buffer.from(JSON.stringify({ version: 1, ...value }), 'utf8').toString('base64url')
    : null;
}

function cursorPayload(value: string | undefined): Record<string, unknown> | null | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) {
      return null;
    }
    const payload = JSON.parse(decoded.toString('utf8')) as Record<string, unknown>;
    return payload.version === 1 ? payload : null;
  } catch {
    return null;
  }
}

function validReadableId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_READABLE_ID_LENGTH &&
    READABLE_ID_PATTERN.test(value)
  );
}

export function encodeMapEntityCursor(cursor: HypermediaEntityContinuation | null): string | null {
  return encodedCursor(cursor);
}

export function decodeMapEntityCursor(
  value: string | undefined,
): { state: 'valid'; cursor?: HypermediaEntityContinuation } | { state: 'invalid' } {
  const payload = cursorPayload(value);
  if (payload === undefined) {
    return { state: 'valid' };
  }
  if (
    !payload ||
    typeof payload.sharedPageCount !== 'number' ||
    !Number.isSafeInteger(payload.sharedPageCount) ||
    payload.sharedPageCount < 1 ||
    !validReadableId(payload.readableId)
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
