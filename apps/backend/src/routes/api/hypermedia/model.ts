import { t } from 'elysia';
import type {
  FocusedHypermediaPages,
  HypermediaPageContinuation,
  HypermediaResource,
  HypermediaResourceContinuation,
  HypermediaResourceNeighborhood,
  HypermediaResourceReference,
} from '#models/hypermedia/model.ts';
import { MAX_KNOWLEDGE_PAGE_TITLE_LENGTH } from '#models/knowledge-pages/model.ts';
import { MAX_TEMPORAL_COVERAGE_LENGTH } from '#models/knowledge-pages/temporal-coverage.ts';
import { MAX_READABLE_ID_LENGTH, READABLE_ID_PATTERN } from '#models/readable-ids/model.ts';
import { AssetSummarySchema, assetSummaryResponse } from '#routes/api/assets/summary-model.ts';
import { EntitySchema, entityResponse } from '#routes/api/entities/model.ts';
import { ReadableIdSchema } from '#routes/api/model.ts';
import { KnowledgePageSummarySchema, pageSummaryResponse } from '#routes/api/pages/model.ts';

export const DEFAULT_HYPERMEDIA_RESOURCE_LIMIT = 16;
export const MAX_HYPERMEDIA_RESOURCE_LIMIT = 24;
export const DEFAULT_HYPERMEDIA_PAGE_LIMIT = 8;
export const MAX_HYPERMEDIA_PAGE_LIMIT = 32;
export const MAX_HYPERMEDIA_PAGE_FOCUS_RESOURCES = 8;
const MAX_HYPERMEDIA_CURSOR_LENGTH = 512;
const MIN_RESOURCE_KEY_LENGTH = 'asset:'.length + 1;
const RESOURCE_KIND_PREFIX_LENGTH = 'entity:'.length;
const MAX_HYPERMEDIA_FOCUS_LENGTH =
  MAX_HYPERMEDIA_PAGE_FOCUS_RESOURCES * (MAX_READABLE_ID_LENGTH + 'entity:,'.length);
const RESOURCE_KEY_PATTERN = `^(?:entity|asset):${READABLE_ID_PATTERN.source.slice(1, -1)}$`;

const HypermediaResourceReferenceSchema = t.Object({
  kind: t.Union([t.Literal('entity'), t.Literal('asset')]),
  readableId: ReadableIdSchema,
});

const HypermediaResourceSchema = t.Union([
  t.Object({ kind: t.Literal('entity'), entity: EntitySchema }),
  t.Object({ kind: t.Literal('asset'), asset: AssetSummarySchema }),
]);

export const HypermediaResourceNeighborhoodQuerySchema = t.Object({
  anchor: t.String({
    minLength: RESOURCE_KIND_PREFIX_LENGTH,
    maxLength: MAX_READABLE_ID_LENGTH + RESOURCE_KIND_PREFIX_LENGTH,
    pattern: RESOURCE_KEY_PATTERN,
  }),
  limit: t.Optional(
    t.Numeric({
      minimum: 1,
      maximum: MAX_HYPERMEDIA_RESOURCE_LIMIT,
      default: DEFAULT_HYPERMEDIA_RESOURCE_LIMIT,
    }),
  ),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: MAX_HYPERMEDIA_CURSOR_LENGTH })),
});

export const HypermediaResourceNeighborhoodSchema = t.Object({
  anchor: HypermediaResourceSchema,
  neighbors: t.Array(
    t.Object({
      resource: HypermediaResourceSchema,
      sharedPageCount: t.Integer({ minimum: 1 }),
    }),
  ),
  nextCursor: t.Nullable(t.String()),
});

export const FocusedHypermediaPagesQuerySchema = t.Object({
  focus: t.String({
    minLength: MIN_RESOURCE_KEY_LENGTH,
    maxLength: MAX_HYPERMEDIA_FOCUS_LENGTH,
  }),
  limit: t.Optional(
    t.Numeric({
      minimum: 1,
      maximum: MAX_HYPERMEDIA_PAGE_LIMIT,
      default: DEFAULT_HYPERMEDIA_PAGE_LIMIT,
    }),
  ),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: MAX_HYPERMEDIA_CURSOR_LENGTH })),
  query: t.Optional(t.String({ maxLength: MAX_KNOWLEDGE_PAGE_TITLE_LENGTH })),
  time: t.Optional(t.String({ minLength: 1, maxLength: MAX_TEMPORAL_COVERAGE_LENGTH })),
  retainPage: t.Optional(ReadableIdSchema),
});

const HypermediaPageSchema = t.Object({
  ...KnowledgePageSummarySchema.properties,
  resources: t.Array(HypermediaResourceReferenceSchema),
});

export const FocusedHypermediaPagesSchema = t.Object({
  pages: t.Array(HypermediaPageSchema),
  nextCursor: t.Nullable(t.String()),
  truncated: t.Boolean(),
});

export function parseHypermediaResourceReference(
  value: string,
): HypermediaResourceReference | null {
  const separator = value.indexOf(':');
  const kind = value.slice(0, separator);
  const readableId = value.slice(separator + 1);
  if (
    (kind !== 'entity' && kind !== 'asset') ||
    readableId.length > MAX_READABLE_ID_LENGTH ||
    !READABLE_ID_PATTERN.test(readableId)
  ) {
    return null;
  }
  return { kind, readableId };
}

export function parseHypermediaFocus(value: string): HypermediaResourceReference[] | null {
  const references = value.split(',').map(parseHypermediaResourceReference);
  if (
    references.length === 0 ||
    references.length > MAX_HYPERMEDIA_PAGE_FOCUS_RESOURCES ||
    references.some((reference) => reference === null)
  ) {
    return null;
  }
  const unique = new Map(
    references.map((reference) => [`${reference!.kind}:${reference!.readableId}`, reference!]),
  );
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

function safeIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value));
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function encodeHypermediaResourceCursor(
  cursor: HypermediaResourceContinuation | null,
): string | null {
  return encodedCursor(cursor);
}

export function decodeHypermediaResourceCursor(
  value: string | undefined,
): { state: 'valid'; cursor?: HypermediaResourceContinuation } | { state: 'invalid' } {
  const payload = cursorPayload(value);
  if (payload === undefined) {
    return { state: 'valid' };
  }
  if (
    !payload ||
    typeof payload.sharedPageCount !== 'number' ||
    !Number.isSafeInteger(payload.sharedPageCount) ||
    payload.sharedPageCount < 1 ||
    (payload.kind !== 'entity' && payload.kind !== 'asset') ||
    !validReadableId(payload.readableId)
  ) {
    return { state: 'invalid' };
  }
  return {
    state: 'valid',
    cursor: {
      sharedPageCount: payload.sharedPageCount,
      kind: payload.kind,
      readableId: payload.readableId,
    },
  };
}

export function encodeHypermediaPageCursor(
  cursor: HypermediaPageContinuation | null,
): string | null {
  return encodedCursor(cursor);
}

export function decodeHypermediaPageCursor(
  value: string | undefined,
): { state: 'valid'; cursor?: HypermediaPageContinuation } | { state: 'invalid' } {
  const payload = cursorPayload(value);
  if (payload === undefined) {
    return { state: 'valid' };
  }
  if (
    !payload ||
    typeof payload.retained !== 'boolean' ||
    typeof payload.temporal !== 'boolean' ||
    typeof payload.ongoing !== 'boolean' ||
    !safeIntegerOrNull(payload.latest) ||
    !safeIntegerOrNull(payload.start) ||
    (payload.temporal && (payload.latest === null || payload.start === null)) ||
    (!payload.temporal && (payload.ongoing || payload.latest !== null || payload.start !== null)) ||
    !canonicalTimestamp(payload.updatedAt) ||
    !validReadableId(payload.readableId)
  ) {
    return { state: 'invalid' };
  }
  return {
    state: 'valid',
    cursor: {
      retained: payload.retained,
      temporal: payload.temporal,
      ongoing: payload.ongoing,
      latest: payload.latest,
      start: payload.start,
      updatedAt: payload.updatedAt,
      readableId: payload.readableId,
    },
  };
}

function hypermediaResourceResponse(resource: HypermediaResource) {
  return resource.kind === 'entity'
    ? { kind: resource.kind, entity: entityResponse(resource.entity) }
    : { kind: resource.kind, asset: assetSummaryResponse(resource.asset) };
}

export function hypermediaResourceNeighborhoodResponse(
  neighborhood: HypermediaResourceNeighborhood,
) {
  return {
    anchor: hypermediaResourceResponse(neighborhood.anchor),
    neighbors: neighborhood.neighbors.map(({ resource, sharedPageCount }) => ({
      resource: hypermediaResourceResponse(resource),
      sharedPageCount,
    })),
    nextCursor: encodeHypermediaResourceCursor(neighborhood.nextPage),
  };
}

export function focusedHypermediaPagesResponse(result: FocusedHypermediaPages) {
  return {
    pages: result.pages.map((page) => ({
      ...pageSummaryResponse(page),
      resources: page.resources,
    })),
    nextCursor: encodeHypermediaPageCursor(result.nextPage),
    truncated: result.truncated,
  };
}
