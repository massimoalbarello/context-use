import { t } from 'elysia';
import {
  type KnowledgePage,
  type KnowledgePageReference,
  type KnowledgePageRevisionSummary,
  type KnowledgePageSummary,
  MAX_KNOWLEDGE_PAGE_BYTES,
  MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH,
  MAX_KNOWLEDGE_PAGE_TITLE_LENGTH,
} from '#models/knowledge-pages/model.ts';
import { AssetSummarySchema, assetSummaryResponse } from '#routes/api/assets/summary-model.ts';
import { EntitySchema, entityResponse } from '#routes/api/entities/model.ts';
import {
  PaginationMetadataSchema,
  PaginationQuerySchema,
  ReadableIdSchema,
} from '#routes/api/model.ts';

export const KnowledgePageSummarySchema = t.Object({
  readableId: ReadableIdSchema,
  title: t.String(),
  excerpt: t.String({ maxLength: MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH }),
  revisionNumber: t.Integer({ minimum: 1 }),
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

export const KnowledgePageReferenceSchema = t.Object({
  page: KnowledgePageSummarySchema,
  fragment: t.Nullable(ReadableIdSchema),
});

export const KnowledgePageRevisionSummarySchema = t.Object({
  revisionNumber: t.Integer({ minimum: 1 }),
  title: t.String(),
  author: t.Union([
    t.Object({ kind: t.Literal('owner'), name: t.String() }),
    t.Object({ kind: t.Literal('mcp_client'), name: t.String() }),
  ]),
  createdAt: t.Date(),
});

export const KnowledgePageAssetUsageSchema = t.Object({
  asset: AssetSummarySchema,
  presentation: t.Union([t.Literal('embed'), t.Literal('attachment')]),
});

export const KnowledgePageSchema = t.Object({
  ...KnowledgePageSummarySchema.properties,
  markdown: t.String(),
  mentions: t.Array(EntitySchema),
  references: t.Array(KnowledgePageReferenceSchema),
  backlinks: t.Array(KnowledgePageReferenceSchema),
  assetUsages: t.Array(KnowledgePageAssetUsageSchema),
  revisions: t.Array(KnowledgePageRevisionSummarySchema),
});

export const CreateKnowledgePageBodySchema = t.Object({
  markdown: t.String({ minLength: 1, maxLength: MAX_KNOWLEDGE_PAGE_BYTES }),
  allowDuplicate: t.Optional(t.Boolean()),
});

export const UpdateKnowledgePageBodySchema = t.Object({
  expectedRevisionNumber: t.Integer({ minimum: 1 }),
  markdown: t.String({ minLength: 1, maxLength: MAX_KNOWLEDGE_PAGE_BYTES }),
});

export const KnowledgePageParamsSchema = t.Object({ pageReadableId: ReadableIdSchema });
export const KnowledgePageListSchema = t.Object({
  items: t.Array(KnowledgePageSummarySchema),
  ...PaginationMetadataSchema.properties,
});
export const KnowledgePageListQuerySchema = t.Object({
  ...PaginationQuerySchema.properties,
  query: t.Optional(t.String({ maxLength: MAX_KNOWLEDGE_PAGE_TITLE_LENGTH })),
});

export function pageSummaryResponse(page: KnowledgePageSummary) {
  return {
    readableId: page.readableId,
    title: page.title,
    excerpt: page.excerpt,
    revisionNumber: page.revisionNumber,
    createdAt: new Date(page.createdAt),
    updatedAt: new Date(page.updatedAt),
  };
}

function pageReferenceResponse(reference: KnowledgePageReference) {
  return { page: pageSummaryResponse(reference.page), fragment: reference.fragment };
}

function pageRevisionResponse(revision: KnowledgePageRevisionSummary) {
  return { ...revision, createdAt: new Date(revision.createdAt) };
}

export function knowledgePageResponse(page: KnowledgePage) {
  return {
    ...pageSummaryResponse(page),
    markdown: page.markdown,
    mentions: page.mentions.map(entityResponse),
    references: page.references.map(pageReferenceResponse),
    backlinks: page.backlinks.map(pageReferenceResponse),
    assetUsages: page.assetUsages.map(({ asset, presentation }) => ({
      asset: assetSummaryResponse(asset),
      presentation,
    })),
    revisions: page.revisions.map(pageRevisionResponse),
  };
}
