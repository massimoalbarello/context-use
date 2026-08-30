import { t } from 'elysia';
import {
  type KnowledgePage,
  type KnowledgePageReference,
  type KnowledgePageRevisionSummary,
  type KnowledgePageSummary,
  MAX_KNOWLEDGE_PAGE_BYTES,
} from '#pages/knowledge-page.ts';
import { EntitySchema, entityResponse } from '#routes/api/entities/model.ts';
import {
  PaginationMetadataSchema,
  PaginationQuerySchema,
  ReadableIdSchema,
} from '#routes/api/model.ts';

export const KnowledgePageSummarySchema = t.Object({
  id: t.String({ format: 'uuid' }),
  readableId: ReadableIdSchema,
  title: t.String(),
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
  createdAt: t.Date(),
});

export const KnowledgePageSchema = t.Object({
  ...KnowledgePageSummarySchema.properties,
  markdown: t.String(),
  mentions: t.Array(EntitySchema),
  references: t.Array(KnowledgePageReferenceSchema),
  backlinks: t.Array(KnowledgePageReferenceSchema),
  revisions: t.Array(KnowledgePageRevisionSummarySchema),
});

export const CreateKnowledgePageBodySchema = t.Object({
  readableId: t.Optional(ReadableIdSchema),
  markdown: t.String({ minLength: 1, maxLength: MAX_KNOWLEDGE_PAGE_BYTES }),
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
export const KnowledgePageListQuerySchema = PaginationQuerySchema;

export function pageSummaryResponse(page: KnowledgePageSummary) {
  return {
    ...page,
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
    revisions: page.revisions.map(pageRevisionResponse),
  };
}
