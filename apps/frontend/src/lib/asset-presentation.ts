export function assetContentUrl(readableId: string): string {
  return `/api/assets/${encodeURIComponent(readableId)}/content`;
}

export function assetDownloadUrl(readableId: string): string {
  return `${assetContentUrl(readableId)}?download=true`;
}

export function isEmbeddableAsset(asset: { mediaType: string }): boolean {
  return ['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(asset.mediaType);
}
