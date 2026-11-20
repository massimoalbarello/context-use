import { z } from 'zod';

// The document UUID in web_url preserves MCP record identity; public not_* IDs do not.
export const meetingIdSchema = z.uuid().transform((id) => id.toLowerCase());

export function meetingIdFromUrl(value: string): string {
  const url = new URL(value);
  const path = /^\/d\/([^/]+)\/?$/.exec(url.pathname);
  if (url.origin !== 'https://notes.granola.ai' || url.username || url.password || !path) {
    throw new Error('Granola note URL does not identify a meeting.');
  }
  return meetingIdSchema.parse(path[1]);
}
