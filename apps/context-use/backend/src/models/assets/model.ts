import type { EntityReference } from '#backend/models/entities/model.ts';
import type { KnowledgePageSummary } from '#backend/models/knowledge-pages/model.ts';
import type { PublicationStatus } from '#backend/models/publications/model.ts';

const BYTES_PER_KIBIBYTE = 1024;
const KIBIBYTES_PER_MEBIBYTE = 1024;
export const MAX_ASSET_MEBIBYTES = 100;
export const MAX_ASSET_BYTES = MAX_ASSET_MEBIBYTES * KIBIBYTES_PER_MEBIBYTE * BYTES_PER_KIBIBYTE;
export const MAX_ASSET_NAME_LENGTH = 160;

export type AssetPresentation = 'embed' | 'attachment';

export interface AssetSummary extends PublicationStatus {
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

export interface RecordAssetUsage {
  kind: 'record';
  record: { readableId: string; title: string; source: { provider: string; kind: string } };
  presentation: AssetPresentation;
}

export type AssetUsage = KnowledgePageAssetUsage | EntityImageAssetUsage | RecordAssetUsage;

export type AssetImport = Pick<
  StoredAsset,
  'ownerId' | 'readableId' | 'name' | 'sizeBytes' | 'contentHash'
>;

export interface Asset extends AssetSummary {
  usages: AssetUsage[];
  depicts: Array<{ entity: EntityReference; source: 'detected' | 'confirmed' }>;
}

export interface StoredAsset extends AssetSummary {
  ownerId: string;
  storageKey: string;
  contentHash: string;
}
