import type { Entity } from '#models/entities/model.ts';

export const MAX_KNOWLEDGE_PAGE_BYTES = 1_000_000;
export const MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH = 280;
export const MAX_KNOWLEDGE_PAGE_TITLE_LENGTH = 240;

export interface KnowledgePageSummary {
  id: string;
  readableId: string;
  title: string;
  excerpt: string;
  revisionNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgePageReference {
  page: KnowledgePageSummary;
  fragment: string | null;
}

export interface KnowledgePageRevisionSummary {
  revisionNumber: number;
  title: string;
  createdAt: string;
}

export interface KnowledgePage extends KnowledgePageSummary {
  markdown: string;
  mentions: Entity[];
  references: KnowledgePageReference[];
  backlinks: KnowledgePageReference[];
  revisions: KnowledgePageRevisionSummary[];
}

export interface StoredKnowledgePage extends KnowledgePageSummary {
  ownerId: string;
  currentRevisionId: string;
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
}

export interface KnowledgePageLinkSet {
  entityReadableIds: string[];
  pageReferences: Array<{ readableId: string; fragment: string | null }>;
}
