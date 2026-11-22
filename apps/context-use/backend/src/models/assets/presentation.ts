export const EMBEDDABLE_ASSET_MEDIA_TYPES = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const EMBEDDABLE_ASSET_MEDIA_TYPE_SET = new Set<string>(EMBEDDABLE_ASSET_MEDIA_TYPES);

export function isEmbeddableAssetMedia(mediaType: string): boolean {
  return EMBEDDABLE_ASSET_MEDIA_TYPE_SET.has(mediaType);
}

export function isVideoAssetMedia(mediaType: string): boolean {
  return mediaType.startsWith('video/');
}

export function assetPreviewKind(mediaType: string) {
  if (isEmbeddableAssetMedia(mediaType)) {
    return 'image';
  }
  if (isVideoAssetMedia(mediaType)) {
    return 'video';
  }
  if (mediaType.startsWith('audio/')) {
    return 'audio';
  }
  if (
    mediaType.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType === 'application/pdf'
  ) {
    return 'document';
  }
  return 'unsupported';
}
