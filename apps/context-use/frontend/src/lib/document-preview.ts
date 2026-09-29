import { getStreamAsArrayBuffer, MaxBufferError } from 'get-stream';

export const MAX_DOCUMENT_PREVIEW_BYTES = 20_971_520;

export async function documentPreviewBytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) {
    throw new Error('Could not load this file.');
  }
  if (!response.body) {
    throw new Error('This file is empty.');
  }
  try {
    const buffer = await getStreamAsArrayBuffer(response.body, {
      maxBuffer: MAX_DOCUMENT_PREVIEW_BYTES,
    });
    // Browser document decoders require fixed-size buffers.
    return new Uint8Array(buffer).slice();
  } catch (error) {
    if (error instanceof MaxBufferError) {
      throw new Error('This file is too large to preview.');
    }
    throw error;
  }
}
