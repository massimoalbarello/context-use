const ZIP_END_OF_CENTRAL_DIRECTORY_BYTES = 22;

export function isFinalizedZipFooter(bytes: Uint8Array): boolean {
  if (bytes.byteLength !== ZIP_END_OF_CENTRAL_DIRECTORY_BYTES) return false;
  return bytes[0] === 0x50
    && bytes[1] === 0x4b
    && bytes[2] === 0x05
    && bytes[3] === 0x06
    && bytes[20] === 0
    && bytes[21] === 0;
}

export function zipFooterRange(sizeBytes: number): { start: number; end: number } | null {
  return Number.isSafeInteger(sizeBytes) && sizeBytes >= ZIP_END_OF_CENTRAL_DIRECTORY_BYTES
    ? { start: sizeBytes - ZIP_END_OF_CENTRAL_DIRECTORY_BYTES, end: sizeBytes - 1 }
    : null;
}
