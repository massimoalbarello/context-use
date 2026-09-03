import { t } from 'elysia';
import {
  type KnowledgeMap,
  type KnowledgeMapContinuation,
  MAX_KNOWLEDGE_PAGE_TITLE_LENGTH,
} from '#models/knowledge-pages/model.ts';
import { MAX_TEMPORAL_COVERAGE_LENGTH } from '#models/knowledge-pages/temporal-coverage.ts';
import { MAX_READABLE_ID_LENGTH, READABLE_ID_PATTERN } from '#models/readable-ids/model.ts';
import { assetSummaryResponse } from '#routes/api/assets/summary-model.ts';
import { EntitySchema, entityResponse } from '#routes/api/entities/model.ts';
import {
  KnowledgePageAssetUsageSchema,
  KnowledgePageSummarySchema,
  pageSummaryResponse,
} from '#routes/api/pages/model.ts';

export const DEFAULT_KNOWLEDGE_MAP_PAGE_LIMIT = 24;
export const MAX_KNOWLEDGE_MAP_PAGE_LIMIT = 40;
const MAX_KNOWLEDGE_MAP_CURSOR_LENGTH = 512;

export const KnowledgeMapQuerySchema = t.Object({
  limit: t.Optional(
    t.Numeric({
      minimum: 1,
      maximum: MAX_KNOWLEDGE_MAP_PAGE_LIMIT,
      default: DEFAULT_KNOWLEDGE_MAP_PAGE_LIMIT,
    }),
  ),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: MAX_KNOWLEDGE_MAP_CURSOR_LENGTH })),
  query: t.Optional(t.String({ maxLength: MAX_KNOWLEDGE_PAGE_TITLE_LENGTH })),
  time: t.Optional(t.String({ minLength: 1, maxLength: MAX_TEMPORAL_COVERAGE_LENGTH })),
});

export const KnowledgeMapPageSchema = t.Object({
  ...KnowledgePageSummarySchema.properties,
  mentions: t.Array(EntitySchema),
  assetUsages: t.Array(KnowledgePageAssetUsageSchema),
});

export const KnowledgeMapSchema = t.Object({
  pages: t.Array(KnowledgeMapPageSchema),
  nextCursor: t.Nullable(t.String()),
  truncated: t.Boolean(),
});

export function encodeKnowledgeMapCursor(cursor: KnowledgeMapContinuation | null): string | null {
  if (!cursor) {
    return null;
  }
  return Buffer.from(JSON.stringify({ version: 1, ...cursor }), 'utf8').toString('base64url');
}

function isSafeIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value));
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

export function decodeKnowledgeMapCursor(
  cursor: string | undefined,
): { state: 'valid'; cursor?: KnowledgeMapContinuation } | { state: 'invalid' } {
  if (!cursor) {
    return { state: 'valid' };
  }
  try {
    const decoded = Buffer.from(cursor, 'base64url');
    if (decoded.toString('base64url') !== cursor) {
      return { state: 'invalid' };
    }
    const payload = JSON.parse(decoded.toString('utf8')) as Record<string, unknown>;
    if (
      payload.version !== 1 ||
      typeof payload.temporal !== 'boolean' ||
      typeof payload.ongoing !== 'boolean' ||
      !isSafeIntegerOrNull(payload.latest) ||
      !isSafeIntegerOrNull(payload.start) ||
      (payload.temporal && (payload.latest === null || payload.start === null)) ||
      (!payload.temporal &&
        (payload.ongoing || payload.latest !== null || payload.start !== null)) ||
      !isCanonicalIsoTimestamp(payload.updatedAt) ||
      typeof payload.readableId !== 'string' ||
      payload.readableId.length > MAX_READABLE_ID_LENGTH ||
      !READABLE_ID_PATTERN.test(payload.readableId)
    ) {
      return { state: 'invalid' };
    }
    return {
      state: 'valid',
      cursor: {
        temporal: payload.temporal,
        ongoing: payload.ongoing,
        latest: payload.latest,
        start: payload.start,
        updatedAt: payload.updatedAt,
        readableId: payload.readableId,
      },
    };
  } catch {
    return { state: 'invalid' };
  }
}

export function knowledgeMapResponse(map: KnowledgeMap) {
  const { nextPage, ...response } = map;
  return {
    ...response,
    nextCursor: encodeKnowledgeMapCursor(nextPage),
    pages: map.pages.map((page) => ({
      ...pageSummaryResponse(page),
      mentions: page.mentions.map(entityResponse),
      assetUsages: page.assetUsages.map(({ asset, presentation }) => ({
        asset: assetSummaryResponse(asset),
        presentation,
      })),
    })),
  };
}
