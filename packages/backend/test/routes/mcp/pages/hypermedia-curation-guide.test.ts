import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  canonicalizeHypermediaCurationGuide,
  HYPERMEDIA_CURATION_GUIDE,
  HYPERMEDIA_CURATION_GUIDE_VERSION,
  hypermediaCurationGuideVersion,
} from '#routes/mcp/pages/hypermedia-curation-guide.ts';

const SHA_256_TRUNCATED_BYTE_LENGTH = 16;

test('guide canonicalization is explicit and checkout-independent', () => {
  expect(canonicalizeHypermediaCurationGuide('\uFEFFfirst\r\nsecond\r\n\r\n')).toBe(
    'first\nsecond\n',
  );
  expect(canonicalizeHypermediaCurationGuide('first\nsecond')).toBe('first\nsecond\n');
});

test('guide version is a deterministic 128-bit SHA-256 truncation', () => {
  const expectedVersion = createHash('sha256')
    .update(HYPERMEDIA_CURATION_GUIDE, 'utf8')
    .digest()
    .subarray(0, SHA_256_TRUNCATED_BYTE_LENGTH)
    .toString('base64url');
  expect(HYPERMEDIA_CURATION_GUIDE_VERSION).toBe(expectedVersion);
  expect(HYPERMEDIA_CURATION_GUIDE_VERSION).toBe(
    hypermediaCurationGuideVersion(HYPERMEDIA_CURATION_GUIDE),
  );
  expect(HYPERMEDIA_CURATION_GUIDE_VERSION).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(hypermediaCurationGuideVersion('\uFEFFsame\r\n')).toBe(
    hypermediaCurationGuideVersion('same\n'),
  );
  expect(hypermediaCurationGuideVersion('guide one')).not.toBe(
    hypermediaCurationGuideVersion('guide two'),
  );
});
