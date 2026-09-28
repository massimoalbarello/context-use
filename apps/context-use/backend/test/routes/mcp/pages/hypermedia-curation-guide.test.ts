import { expect, test } from 'bun:test';
import {
  canonicalizeHypermediaCurationGuide,
  HYPERMEDIA_CURATION_GUIDE_VERSION,
  hypermediaCurationGuideVersion,
} from '#backend/routes/mcp/pages/hypermedia-curation-guide.ts';

test('guide canonicalization is explicit and checkout-independent', () => {
  expect(canonicalizeHypermediaCurationGuide('\uFEFFfirst\r\nsecond\r\n\r\n')).toBe(
    'first\nsecond\n',
  );
  expect(canonicalizeHypermediaCurationGuide('first\nsecond')).toBe('first\nsecond\n');
});

test('guide versions ignore checkout formatting and change with content', () => {
  expect(HYPERMEDIA_CURATION_GUIDE_VERSION).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(hypermediaCurationGuideVersion('\uFEFFsame\r\n')).toBe(
    hypermediaCurationGuideVersion('same\n'),
  );
  expect(hypermediaCurationGuideVersion('guide one')).not.toBe(
    hypermediaCurationGuideVersion('guide two'),
  );
});
