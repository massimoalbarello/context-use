import { fileTypeFromBuffer } from 'file-type';

export interface DetectedAssetMedia {
  mediaType: string;
  extension: string | null;
}

export const EMBEDDABLE_ASSET_MEDIA_TYPES = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const EMBEDDABLE_ASSET_MEDIA_TYPE_SET = new Set<string>(EMBEDDABLE_ASSET_MEDIA_TYPES);

export async function detectAssetMedia(bytes: Uint8Array): Promise<DetectedAssetMedia> {
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected) {
    return { mediaType: 'application/octet-stream', extension: null };
  }
  return {
    mediaType: detected.mime,
    extension: detected.ext,
  };
}

export function isEmbeddableAssetMedia(mediaType: string): boolean {
  return EMBEDDABLE_ASSET_MEDIA_TYPE_SET.has(mediaType);
}
