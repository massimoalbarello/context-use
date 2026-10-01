import { z } from 'zod';

// Keep the document UUID as record identity across MCP and the public API's not_* IDs.
export const meetingIdSchema = z.uuid().transform((id) => id.toLowerCase());

export function meetingIdFromUrl(value: string): string {
  const url = new URL(value);
  const path = /^\/d\/([^/]+)\/?$/.exec(url.pathname);
  if (url.origin !== 'https://notes.granola.ai' || url.username || url.password || !path) {
    throw new Error('Granola note URL does not identify a meeting.');
  }
  return meetingIdSchema.parse(path[1]);
}
