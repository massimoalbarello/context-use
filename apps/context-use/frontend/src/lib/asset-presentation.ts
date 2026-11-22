import { isEmbeddableAssetMedia, isVideoAssetMedia } from '#backend/models/assets/presentation.ts';
export function assetContentUrl({
  readableId,
  includeArchived = false,
}: {
  readableId: string;
  includeArchived?: boolean;
}): string {
  return `/api/assets/${encodeURIComponent(readableId)}/content${includeArchived ? '?includeArchived=true' : ''}`;
}

export function assetDownloadUrl({
  readableId,
  includeArchived = false,
}: {
  readableId: string;
  includeArchived?: boolean;
}): string {
  return `${assetContentUrl({ readableId, includeArchived })}${includeArchived ? '&' : '?'}download=true`;
}

export function isEmbeddableAsset(asset: { mediaType: string }): boolean {
  return isEmbeddableAssetMedia(asset.mediaType);
}

export function isVideoAsset(asset: { mediaType: string }): boolean {
  return isVideoAssetMedia(asset.mediaType);
}

export function assetTypeLabel(asset: { mediaType: string; extension?: string | null }): string {
  if (asset.extension) {
    return asset.extension.toUpperCase();
  }
  return asset.mediaType === 'application/octet-stream' ? 'File' : asset.mediaType;
}

const BYTES_PER_KIBIBYTE = 1024;
const KIBIBYTES_PER_MEBIBYTE = 1024;
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * KIBIBYTES_PER_MEBIBYTE;

export function formatAssetSize(sizeBytes: number): string {
  if (sizeBytes < BYTES_PER_KIBIBYTE) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < BYTES_PER_MEBIBYTE) {
    return `${(sizeBytes / BYTES_PER_KIBIBYTE).toFixed(1)} KB`;
  }
  return `${(sizeBytes / BYTES_PER_MEBIBYTE).toFixed(1)} MB`;
}
