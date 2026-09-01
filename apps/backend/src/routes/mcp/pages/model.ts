import { z } from 'zod';
import type {
  KnowledgePage,
  KnowledgePageReference,
  KnowledgePageRevisionSummary,
  KnowledgePageSummary,
} from '#models/knowledge-pages/model.ts';
import {
  McpReadableIdSchema,
  PageAddressSchema,
  PageReferenceAddressSchema,
  pageAddress,
} from '#routes/mcp/coordinates.ts';
import { McpEntitySchema, mcpEntity } from '#routes/mcp/entities/model.ts';

export const McpKnowledgePageSummarySchema = z.object({
  address: PageAddressSchema,
  readableId: McpReadableIdSchema,
  title: z.string(),
  excerpt: z.string(),
  revisionNumber: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const McpKnowledgePageReferenceSchema = z.object({
  address: PageReferenceAddressSchema,
  page: McpKnowledgePageSummarySchema,
  fragment: McpReadableIdSchema.nullable(),
});

const McpKnowledgePageRevisionSchema = z.object({
  revisionNumber: z.number().int().positive(),
  title: z.string(),
  author: z.union([
    z.object({ kind: z.literal('owner'), name: z.string() }),
    z.object({ kind: z.literal('mcp_client'), name: z.string() }),
  ]),
  createdAt: z.string().datetime(),
});

export const McpKnowledgePageSchema = McpKnowledgePageSummarySchema.extend({
  markdown: z.string(),
  mentions: z.array(McpEntitySchema),
  references: z.array(McpKnowledgePageReferenceSchema),
  backlinks: z.array(McpKnowledgePageReferenceSchema),
  revisions: z.array(McpKnowledgePageRevisionSchema),
});

export function mcpKnowledgePageSummary(page: KnowledgePageSummary) {
  return {
    address: pageAddress(page.readableId),
    readableId: page.readableId,
    title: page.title,
    excerpt: page.excerpt,
    revisionNumber: page.revisionNumber,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

function mcpKnowledgePageReference(reference: KnowledgePageReference) {
  const address = pageAddress(reference.page.readableId);
  return {
    address: reference.fragment ? `${address}#${reference.fragment}` : address,
    page: mcpKnowledgePageSummary(reference.page),
    fragment: reference.fragment,
  };
}

function mcpKnowledgePageRevision(revision: KnowledgePageRevisionSummary) {
  return {
    revisionNumber: revision.revisionNumber,
    title: revision.title,
    author: revision.author,
    createdAt: revision.createdAt,
  };
}

export function mcpKnowledgePage(page: KnowledgePage) {
  return {
    ...mcpKnowledgePageSummary(page),
    markdown: page.markdown,
    mentions: page.mentions.map(mcpEntity),
    references: page.references.map(mcpKnowledgePageReference),
    backlinks: page.backlinks.map(mcpKnowledgePageReference),
    revisions: page.revisions.map(mcpKnowledgePageRevision),
  };
}

export function mcpArchiveBlockers(blockers: KnowledgePageReference[]) {
  return blockers.map(mcpKnowledgePageReference);
}
