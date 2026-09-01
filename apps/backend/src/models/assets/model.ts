import type { EntityReference } from '#models/entities/model.ts';
import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';

const BYTES_PER_KIBIBYTE = 1024;
const KIBIBYTES_PER_MEBIBYTE = 1024;
export const MAX_ASSET_MEBIBYTES = 5;
export const MAX_ASSET_BYTES = MAX_ASSET_MEBIBYTES * KIBIBYTES_PER_MEBIBYTE * BYTES_PER_KIBIBYTE;
export const MAX_ASSET_NAME_LENGTH = 160;

export type AssetPresentation = 'embed' | 'attachment';

export interface AssetSummary {
  id: string;
  readableId: string;
  name: string;
  mediaType: string;
  extension: string | null;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgePageAssetUsage {
  kind: 'page';
  page: KnowledgePageSummary;
  presentation: AssetPresentation;
}

export interface EntityImageAssetUsage {
  kind: 'entity_image';
  entity: EntityReference;
}

export type AssetUsage = KnowledgePageAssetUsage | EntityImageAssetUsage;

export interface Asset extends AssetSummary {
  usages: AssetUsage[];
}

export interface StoredAsset extends AssetSummary {
  ownerId: string;
  storageKey: string;
  contentHash: string;
}
