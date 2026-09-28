import { describe, expect, test } from 'bun:test';
import {
  detectAssetMedia,
  EMBEDDABLE_ASSET_MEDIA_TYPES,
  isEmbeddableAssetMedia,
} from '#backend/models/assets/media.ts';

describe('asset media detection', () => {
  test('falls back to a non-executable attachment type for unknown bytes', async () => {
    expect(await detectAssetMedia(Buffer.from('000102ff', 'hex'))).toEqual({
      mediaType: 'application/octet-stream',
      extension: null,
    });
  });

  test('recognizes only the canonical embeddable media types', () => {
    for (const mediaType of EMBEDDABLE_ASSET_MEDIA_TYPES) {
      expect(isEmbeddableAssetMedia(mediaType)).toBe(true);
    }
    expect(isEmbeddableAssetMedia('image/svg+xml')).toBe(false);
    expect(isEmbeddableAssetMedia('application/pdf')).toBe(false);
  });
});

test('recognizes UTF-8 documents and quoted CSV while keeping active markup inert', async () => {
  for (const content of [
    'Rehearsal checklist\n[ ] Walk the demo',
    '<html><script>alert(1)</script></html>',
    '# Notes\nRésumé — ready',
  ]) {
    expect(await detectAssetMedia(Buffer.from(content))).toEqual({
      mediaType: 'text/plain',
      extension: 'txt',
    });
  }
  expect(
    await detectAssetMedia(
      Buffer.from('name,note\n"Phone, first","Line one\nLine two"\nMusic,ready'),
    ),
  ).toEqual({ mediaType: 'text/csv', extension: 'csv' });
  expect(await detectAssetMedia(Buffer.from('c328', 'hex'))).toEqual({
    mediaType: 'application/octet-stream',
    extension: null,
  });
});
