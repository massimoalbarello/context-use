import { t } from 'elysia';
import type { KnowledgeMap } from '#models/knowledge-pages/model.ts';
import { assetSummaryResponse } from '#routes/api/assets/summary-model.ts';
import { EntitySchema, entityResponse } from '#routes/api/entities/model.ts';
import {
  KnowledgePageAssetUsageSchema,
  KnowledgePageReferenceSchema,
  KnowledgePageSummarySchema,
  pageSummaryResponse,
} from '#routes/api/pages/model.ts';

export const DEFAULT_KNOWLEDGE_MAP_PAGE_LIMIT = 24;
export const MAX_KNOWLEDGE_MAP_PAGE_LIMIT = 40;

export const KnowledgeMapQuerySchema = t.Object({
  limit: t.Optional(
    t.Numeric({
      minimum: 1,
      maximum: MAX_KNOWLEDGE_MAP_PAGE_LIMIT,
      default: DEFAULT_KNOWLEDGE_MAP_PAGE_LIMIT,
    }),
  ),
});

export const KnowledgeMapPageSchema = t.Object({
  ...KnowledgePageSummarySchema.properties,
  mentions: t.Array(EntitySchema),
  references: t.Array(KnowledgePageReferenceSchema),
  assetUsages: t.Array(KnowledgePageAssetUsageSchema),
});

export const KnowledgeMapSchema = t.Object({
  pages: t.Array(KnowledgeMapPageSchema),
  totalPages: t.Integer({ minimum: 0 }),
  truncated: t.Boolean(),
});

export function knowledgeMapResponse(map: KnowledgeMap) {
  return {
    ...map,
    pages: map.pages.map((page) => ({
      ...pageSummaryResponse(page),
      mentions: page.mentions.map(entityResponse),
      references: page.references.map(({ page: target, fragment }) => ({
        page: pageSummaryResponse(target),
        fragment,
      })),
      assetUsages: page.assetUsages.map(({ asset, presentation }) => ({
        asset: assetSummaryResponse(asset),
        presentation,
      })),
    })),
  };
}
