import { describe, expect, test } from 'bun:test';
import { detectAssetMedia } from '#models/assets/media.ts';

describe('asset media detection', () => {
  test('derives safe raster types from bytes rather than upload hints', () => {
    expect(detectAssetMedia(Buffer.from('89504e470d0a1a0a', 'hex'))).toEqual({
      mediaType: 'image/png',
      extension: 'png',
      embeddable: true,
    });
  });

  test('recognizes Office documents inside their ZIP container', () => {
    const workbook = Buffer.concat([
      Buffer.from('504b0304', 'hex'),
      Buffer.from('[Content_Types].xml xl/workbook.xml'),
    ]);
    expect(detectAssetMedia(workbook)).toEqual({
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
      embeddable: false,
    });
  });

  test('falls back to a non-executable attachment type for unknown bytes', () => {
    expect(detectAssetMedia(Buffer.from('<html>not served inline</html>'))).toEqual({
      mediaType: 'application/octet-stream',
      extension: null,
      embeddable: false,
    });
  });
});
