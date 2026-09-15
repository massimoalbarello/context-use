import { fileTypeFromBuffer } from 'file-type';
import Papa from 'papaparse';

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
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return { mediaType: 'application/octet-stream', extension: null };
    }
    // Permit whitespace, but never mistake binary control bytes for a document.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting binary control bytes is intentional.
    if (!text || /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/u.test(text)) {
      return { mediaType: 'application/octet-stream', extension: null };
    }
    const csv = Papa.parse<string[]>(text, { skipEmptyLines: true, preview: 20 });
    if (
      csv.errors.length === 0 &&
      csv.data.length > 1 &&
      csv.data[0]!.length > 1 &&
      csv.data.every((row) => row.length === csv.data[0]!.length)
    ) {
      return { mediaType: 'text/csv', extension: 'csv' };
    }
    // HTML, SVG, Markdown and source code remain inert text, never executable markup.
    return { mediaType: 'text/plain', extension: 'txt' };
  }
  return {
    mediaType: detected.mime,
    extension: detected.ext,
  };
}

export function isEmbeddableAssetMedia(mediaType: string): boolean {
  return EMBEDDABLE_ASSET_MEDIA_TYPE_SET.has(mediaType);
}
