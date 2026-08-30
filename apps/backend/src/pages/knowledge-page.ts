import type { Entity } from '#entities/entity.ts';
import type { Page } from '#pagination/page.ts';

export const MAX_KNOWLEDGE_PAGE_BYTES = 1_000_000;
export const MAX_KNOWLEDGE_PAGE_TITLE_LENGTH = 240;

export interface KnowledgePageSummary {
  id: string;
  readableId: string;
  title: string;
  revisionNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgePageReference {
  page: KnowledgePageSummary;
  fragment: string | null;
}

export interface KnowledgePage extends KnowledgePageSummary {
  markdown: string;
  mentions: Entity[];
  references: KnowledgePageReference[];
  backlinks: KnowledgePageReference[];
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

export interface KnowledgePagesRepositoryContract {
  create(input: {
    pageId: string;
    revisionId: string;
    ownerId: string;
    readableId: string;
    title: string;
    storageKey: string;
    contentHash: string;
    sizeBytes: number;
    links: KnowledgePageLinkSet;
    createdAt: string;
  }): Promise<
    | { state: 'created'; page: StoredKnowledgePage }
    | { state: 'readable_id_conflict' }
    | { state: 'link_target_not_found'; target: string }
  >;
  update(input: {
    revisionId: string;
    ownerId: string;
    readableId: string;
    expectedRevisionNumber: number;
    title: string;
    storageKey: string;
    contentHash: string;
    sizeBytes: number;
    links: KnowledgePageLinkSet;
    updatedAt: string;
  }): Promise<
    | { state: 'updated'; page: StoredKnowledgePage }
    | { state: 'not_found' }
    | { state: 'revision_conflict'; currentRevisionNumber: number }
    | { state: 'link_target_not_found'; target: string }
  >;
  list(input: {
    ownerId: string;
    limit: number;
    offset: number;
  }): Promise<Page<KnowledgePageSummary>>;
  listByEntity(input: {
    ownerId: string;
    entityReadableId: string;
  }): Promise<KnowledgePageSummary[]>;
  find(input: { ownerId: string; readableId: string }): Promise<StoredKnowledgePage | null>;
  detail(input: { ownerId: string; readableId: string }): Promise<{
    page: StoredKnowledgePage;
    mentions: Entity[];
    references: KnowledgePageReference[];
    backlinks: KnowledgePageReference[];
  } | null>;
  listCurrent(input: { ownerId: string }): Promise<StoredKnowledgePage[]>;
  replaceCurrentLinks(input: {
    ownerId: string;
    readableId: string;
    links: KnowledgePageLinkSet;
  }): Promise<{ state: 'replaced' } | { state: 'link_target_not_found'; target: string }>;
}
