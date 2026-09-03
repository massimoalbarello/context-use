import type { AssetPresentation, AssetSummary } from '#models/assets/model.ts';
import type { Entity } from '#models/entities/model.ts';

export const MAX_KNOWLEDGE_PAGE_BYTES = 1_000_000;
export const MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH = 280;
export const MAX_KNOWLEDGE_PAGE_TITLE_LENGTH = 240;

export interface KnowledgePageSummary {
  id: string;
  readableId: string;
  title: string;
  excerpt: string;
  temporalCoverage: string | null;
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
  temporalCoverage: string | null;
  author: KnowledgePageRevisionAuthor;
  createdAt: string;
}

export type KnowledgePageRevisionAuthor =
  | { kind: 'owner'; name: string }
  | { kind: 'mcp_client'; name: string };

export type KnowledgePageRevisionActor =
  | { kind: 'owner' }
  | { kind: 'mcp_client'; clientAuthorizationId: string; name: string };

export interface KnowledgePageAssetUsage {
  asset: AssetSummary;
  presentation: AssetPresentation;
}

export interface KnowledgePage extends KnowledgePageSummary {
  markdown: string;
  mentions: Entity[];
  references: KnowledgePageReference[];
  backlinks: KnowledgePageReference[];
  assetUsages: KnowledgePageAssetUsage[];
  revisions: KnowledgePageRevisionSummary[];
}

export interface KnowledgePagePreview extends KnowledgePageSummary {
  markdown: string;
  mentions: Entity[];
}

export interface KnowledgeMapPage extends KnowledgePageSummary {
  mentions: Entity[];
  assetUsages: KnowledgePageAssetUsage[];
}

export interface KnowledgeMapContinuation {
  temporal: boolean;
  ongoing: boolean;
  latest: number | null;
  start: number | null;
  updatedAt: string;
  readableId: string;
}

export interface KnowledgeMap {
  pages: KnowledgeMapPage[];
  nextPage: KnowledgeMapContinuation | null;
  truncated: boolean;
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
  assetUsages: Array<{ readableId: string; presentation: AssetPresentation }>;
}
