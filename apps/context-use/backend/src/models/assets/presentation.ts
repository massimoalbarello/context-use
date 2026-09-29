const VIDEO_MEDIA_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']);

export function isVideoAssetMedia(mediaType: string): boolean {
  return VIDEO_MEDIA_TYPES.has(mediaType);
}
