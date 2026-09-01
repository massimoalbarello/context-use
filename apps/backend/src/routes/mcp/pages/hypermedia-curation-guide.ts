import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import HYPERMEDIA_CURATION_GUIDE_SOURCE from '#routes/mcp/pages/hypermedia-curation-guide.md' with {
  type: 'text',
};

const HYPERMEDIA_CURATION_GUIDE_REQUIRED_MESSAGE =
  'Call read_hypermedia_curation_guide, then retry this tool with the returned guide_version.';
const HYPERMEDIA_CURATION_GUIDE_VERSION_BYTE_LENGTH = 16;
const HYPERMEDIA_CURATION_GUIDE_VERSION_HEX_LENGTH =
  HYPERMEDIA_CURATION_GUIDE_VERSION_BYTE_LENGTH * 2;
export const HYPERMEDIA_CURATION_GUIDE_VERSION_LENGTH = 22;

export const HypermediaCurationGuideRequiredSchema = z.object({
  status: z.literal('action_required'),
  code: z.literal('hypermedia_curation_guide_required'),
  message: z.literal(HYPERMEDIA_CURATION_GUIDE_REQUIRED_MESSAGE),
});

export const HypermediaCurationGuideOutputSchema = z.object({
  guide: z.string(),
  guide_version: z
    .string()
    .length(HYPERMEDIA_CURATION_GUIDE_VERSION_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/),
});

export const HypermediaCurationGuideVersionInputSchema = z
  .string()
  .optional()
  .describe('Version returned by read_hypermedia_curation_guide');

// Canonical bytes are UTF-8 after removing one leading BOM, normalizing CRLF/CR to LF, and
// collapsing trailing LFs to exactly one. No other whitespace or Unicode normalization occurs.
export function canonicalizeHypermediaCurationGuide(guide: string): string {
  return guide
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .concat('\n');
}

export function hypermediaCurationGuideVersion(guide: string): string {
  const canonicalGuide = canonicalizeHypermediaCurationGuide(guide);
  const digest = new Bun.CryptoHasher('sha256').update(canonicalGuide).digest('hex');
  // The first 16 digest bytes are the documented 128-bit, non-secret content identifier.
  return Buffer.from(digest.slice(0, HYPERMEDIA_CURATION_GUIDE_VERSION_HEX_LENGTH), 'hex').toString(
    'base64url',
  );
}

export const HYPERMEDIA_CURATION_GUIDE = canonicalizeHypermediaCurationGuide(
  HYPERMEDIA_CURATION_GUIDE_SOURCE,
);

export const HYPERMEDIA_CURATION_GUIDE_VERSION =
  hypermediaCurationGuideVersion(HYPERMEDIA_CURATION_GUIDE);

export function hypermediaCurationGuideRequired(
  guideVersion: string | undefined,
): CallToolResult | null {
  if (guideVersion === HYPERMEDIA_CURATION_GUIDE_VERSION) {
    return null;
  }
  const result = {
    status: 'action_required' as const,
    code: 'hypermedia_curation_guide_required' as const,
    message: HYPERMEDIA_CURATION_GUIDE_REQUIRED_MESSAGE,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
  };
}
