import { isVideoAssetMedia } from '#backend/models/assets/presentation.ts';
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
  return ['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(asset.mediaType);
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
