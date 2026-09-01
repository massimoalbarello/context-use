import { z } from 'zod';

export const DEFAULT_MCP_LIST_LIMIT = 30;
export const MAX_MCP_LIST_LIMIT = 50;
const MAX_MCP_CURSOR_LENGTH = 512;

export const McpListInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_MCP_LIST_LIMIT)
    .optional()
    .describe(`Number of items to return, from 1 to ${MAX_MCP_LIST_LIMIT}`),
  cursor: z
    .string()
    .min(1)
    .max(MAX_MCP_CURSOR_LENGTH)
    .optional()
    .describe('Opaque continuation cursor returned by the preceding list call'),
});

type McpListKind = 'assets' | 'entities' | 'knowledge_pages';

const CursorPayloadSchema = z.object({
  version: z.literal(1),
  list: z.union([z.literal('assets'), z.literal('entities'), z.literal('knowledge_pages')]),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export function encodeMcpCursor({
  list,
  offset,
}: {
  list: McpListKind;
  offset: number | null;
}): string | null {
  if (offset === null) {
    return null;
  }
  return Buffer.from(JSON.stringify({ version: 1, list, offset }), 'utf8').toString('base64url');
}

export function decodeMcpCursor({
  cursor,
  list,
}: {
  cursor: string | undefined;
  list: McpListKind;
}): { state: 'valid'; offset: number } | { state: 'invalid' } {
  if (!cursor) {
    return { state: 'valid', offset: 0 };
  }
  try {
    const decoded = Buffer.from(cursor, 'base64url');
    if (decoded.toString('base64url') !== cursor) {
      return { state: 'invalid' };
    }
    const payload = CursorPayloadSchema.parse(JSON.parse(decoded.toString('utf8')));
    return payload.list === list
      ? { state: 'valid', offset: payload.offset }
      : { state: 'invalid' };
  } catch {
    return { state: 'invalid' };
  }
}
