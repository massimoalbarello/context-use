export interface DetectedAssetMedia {
  mediaType: string;
  extension: string | null;
  embeddable: boolean;
}

const SIGNATURES: Array<{
  bytes: Uint8Array;
  offset?: number;
  mediaType: string;
  extension: string;
  embeddable?: boolean;
}> = [
  {
    bytes: Buffer.from('89504e470d0a1a0a', 'hex'),
    mediaType: 'image/png',
    extension: 'png',
    embeddable: true,
  },
  {
    bytes: Buffer.from('ffd8ff', 'hex'),
    mediaType: 'image/jpeg',
    extension: 'jpg',
    embeddable: true,
  },
  {
    bytes: Buffer.from('47494638', 'hex'),
    mediaType: 'image/gif',
    extension: 'gif',
    embeddable: true,
  },
  { bytes: Buffer.from('25504446', 'hex'), mediaType: 'application/pdf', extension: 'pdf' },
  { bytes: Buffer.from('1f8b', 'hex'), mediaType: 'application/gzip', extension: 'gz' },
];

const RIFF_SIGNATURE = Buffer.from('52494646', 'hex');
const WEBP_SIGNATURE = Buffer.from('57454250', 'hex');
const ZIP_SIGNATURE = Buffer.from('504b0304', 'hex');
const RIFF_SIZE_FIELD_BYTES = 4;
const WEBP_SIGNATURE_OFFSET = RIFF_SIGNATURE.byteLength + RIFF_SIZE_FIELD_BYTES;

function detectZipMedia(bytes: Uint8Array): DetectedAssetMedia | null {
  if (!startsWith({ bytes, signature: ZIP_SIGNATURE })) {
    return null;
  }
  const directoryText = Buffer.from(bytes).toString('latin1');
  if (directoryText.includes('[Content_Types].xml')) {
    if (directoryText.includes('xl/')) {
      return {
        mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx',
        embeddable: false,
      };
    }
    if (directoryText.includes('word/')) {
      return {
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
        embeddable: false,
      };
    }
    if (directoryText.includes('ppt/')) {
      return {
        mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        extension: 'pptx',
        embeddable: false,
      };
    }
  }
  return { mediaType: 'application/zip', extension: 'zip', embeddable: false };
}

function startsWith({
  bytes,
  signature,
  offset = 0,
}: {
  bytes: Uint8Array;
  signature: Uint8Array;
  offset?: number;
}): boolean {
  let index = 0;
  for (const byte of signature) {
    if (bytes[offset + index] !== byte) {
      return false;
    }
    index += 1;
  }
  return true;
}

export function detectAssetMedia(bytes: Uint8Array): DetectedAssetMedia {
  if (
    startsWith({ bytes, signature: RIFF_SIGNATURE }) &&
    startsWith({ bytes, signature: WEBP_SIGNATURE, offset: WEBP_SIGNATURE_OFFSET })
  ) {
    return { mediaType: 'image/webp', extension: 'webp', embeddable: true };
  }

  const zipMedia = detectZipMedia(bytes);
  if (zipMedia) {
    return zipMedia;
  }

  const match = SIGNATURES.find((signature) =>
    startsWith({ bytes, signature: signature.bytes, offset: signature.offset }),
  );
  return match
    ? {
        mediaType: match.mediaType,
        extension: match.extension,
        embeddable: match.embeddable ?? false,
      }
    : { mediaType: 'application/octet-stream', extension: null, embeddable: false };
}

export function isEmbeddableAssetMedia(mediaType: string): boolean {
  return ['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(mediaType);
}
