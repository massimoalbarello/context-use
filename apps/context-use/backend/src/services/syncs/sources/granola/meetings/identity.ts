import { z } from 'zod';

// API migration: derive record IDs from web_url's document UUID, never the API's not_* ID.
// Granola does not guarantee it equals the MCP ID; verify an overlapping real meeting first.
// Keep provider granola, kind meeting, and the existing sync instance when backfilling history
// (record uniqueness includes sync_id). Reset the acquisition checkpoint, not record revisions.
export const meetingIdSchema = z.uuid().transform((id) => id.toLowerCase());

export function meetingIdFromUrl(value: string): string {
  const url = new URL(value);
  const path = /^\/d\/([^/]+)\/?$/.exec(url.pathname);
  if (url.origin !== 'https://notes.granola.ai' || url.username || url.password || !path) {
    throw new Error('Granola note URL does not identify a meeting.');
  }
  return meetingIdSchema.parse(path[1]);
}
