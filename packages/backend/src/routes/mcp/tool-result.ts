import type { CallToolResult } from '@modelcontextprotocol/server';

export function mcpToolSuccess(result: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

export function mcpToolError({
  code,
  message,
  details,
}: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): CallToolResult {
  const result = { error: { code, message, ...details } };
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    isError: true,
  };
}
