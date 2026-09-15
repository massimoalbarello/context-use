export function assetContentUrl(readableId: string): string {
  return `/api/assets/${encodeURIComponent(readableId)}/content`;
}

export function assetDownloadUrl(readableId: string): string {
  return `${assetContentUrl(readableId)}?download=true`;
}

export function isEmbeddableAsset(asset: { mediaType: string }): boolean {
  return ['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(asset.mediaType);
}

export function isVideoAsset(asset: { mediaType: string }): boolean {
  return ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'].includes(asset.mediaType);
}

export function assetTypeLabel(asset: { mediaType: string; extension?: string | null }): string {
  if (asset.extension) {
    return asset.extension.toUpperCase();
  }
  return asset.mediaType === 'application/octet-stream' ? 'File' : asset.mediaType;
}
