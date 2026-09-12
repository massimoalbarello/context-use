import { t } from 'elysia';
import type {
  HypermediaEntityContinuation,
  HypermediaEntityNeighborhood,
  HypermediaEntityReference,
  HypermediaPages,
} from '#models/hypermedia/model.ts';
import { MAX_TEMPORAL_COVERAGE_LENGTH } from '#models/knowledge-pages/temporal-coverage.ts';
import { MAX_READABLE_ID_LENGTH, READABLE_ID_PATTERN } from '#models/readable-ids/model.ts';
import { EntitySchema, entityResponse } from '#routes/api/entities/model.ts';
import { PaginationQuerySchema, ReadableIdSchema } from '#routes/api/model.ts';
import { KnowledgePageSummarySchema, pageSummaryResponse } from '#routes/api/pages/model.ts';

export const DEFAULT_HYPERMEDIA_ENTITY_LIMIT = 16;
export const MAX_HYPERMEDIA_ENTITY_LIMIT = 24;
export const DEFAULT_HYPERMEDIA_PAGE_LIMIT = 32;
export const MAX_HYPERMEDIA_PAGE_LIMIT = 32;
export const MAX_HYPERMEDIA_PAGE_FOCUS_ENTITIES = 24;
const MAX_HYPERMEDIA_CURSOR_LENGTH = 512;
const MAX_HYPERMEDIA_FOCUS_LENGTH =
  MAX_HYPERMEDIA_PAGE_FOCUS_ENTITIES * (MAX_READABLE_ID_LENGTH + 1);

const HypermediaEntityReferenceSchema = t.Object({
  readableId: ReadableIdSchema,
});

export const HypermediaEntityNeighborhoodQuerySchema = t.Object({
  anchor: ReadableIdSchema,
  limit: t.Optional(
    t.Numeric({
      minimum: 1,
      maximum: MAX_HYPERMEDIA_ENTITY_LIMIT,
      default: DEFAULT_HYPERMEDIA_ENTITY_LIMIT,
    }),
  ),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: MAX_HYPERMEDIA_CURSOR_LENGTH })),
});

export const HypermediaEntityNeighborhoodSchema = t.Object({
  anchor: EntitySchema,
  neighbors: t.Array(
    t.Object({
      entity: EntitySchema,
      sharedPageCount: t.Integer({ minimum: 1 }),
    }),
  ),
  nextCursor: t.Nullable(t.String()),
});

export const HypermediaPagesQuerySchema = t.Object({
  entities: t.Optional(
    t.String({
      minLength: 1,
      maxLength: MAX_HYPERMEDIA_FOCUS_LENGTH,
    }),
  ),
  visible: t.Optional(
    t.String({
      minLength: 1,
      maxLength: MAX_HYPERMEDIA_FOCUS_LENGTH,
    }),
  ),
  limit: t.Optional(
    t.Numeric({
      minimum: 1,
      maximum: MAX_HYPERMEDIA_PAGE_LIMIT,
      default: DEFAULT_HYPERMEDIA_PAGE_LIMIT,
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

const HypermediaPageSchema = t.Object({
  ...KnowledgePageSummarySchema.properties,
  entities: t.Array(HypermediaEntityReferenceSchema),
});

export const HypermediaPagesSchema = t.Object({
  pages: t.Array(HypermediaPageSchema),
  nextOffset: t.Nullable(t.Integer({ minimum: 0 })),
  entityReferencesTruncated: t.Boolean(),
});

export function parseHypermediaEntityReference(value: string): HypermediaEntityReference | null {
  return validReadableId(value) ? { readableId: value } : null;
}

export function parseHypermediaEntities(value?: string): HypermediaEntityReference[] | null {
  if (value === undefined) {
    return [];
  }
  const references = value.split(',').map(parseHypermediaEntityReference);
  if (
    references.length === 0 ||
    references.length > MAX_HYPERMEDIA_PAGE_FOCUS_ENTITIES ||
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

export function encodeHypermediaEntityCursor(
  cursor: HypermediaEntityContinuation | null,
): string | null {
  return encodedCursor(cursor);
}

export function decodeHypermediaEntityCursor(
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

export function hypermediaEntityNeighborhoodResponse(neighborhood: HypermediaEntityNeighborhood) {
  return {
    anchor: entityResponse(neighborhood.anchor),
    neighbors: neighborhood.neighbors.map(({ entity, sharedPageCount }) => ({
      entity: entityResponse(entity),
      sharedPageCount,
    })),
    nextCursor: encodeHypermediaEntityCursor(neighborhood.nextPage),
  };
}

export function hypermediaPagesResponse(result: HypermediaPages) {
  return {
    pages: result.pages.map((page) => ({
      ...pageSummaryResponse(page),
      entities: page.entities,
    })),
    nextOffset: result.nextOffset,
    entityReferencesTruncated: result.entityReferencesTruncated,
  };
}
