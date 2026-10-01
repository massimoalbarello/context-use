import { z } from 'zod';

export const pageSize = 50;
const token = z.string().min(1);
export const checkpointSchema = z.strictObject({
  // Primary calendar ID binds this checkpoint to the Google account. Verify it
  // before every page, including after completion, before using saved cursors.
  account: token.nullable(),
  // Completed change-feed position per calendar, retained across polls. Never
  // replace a token while paging: every delta page uses the same starting token.
  syncTokens: z.record(token, token),
  // Next native calendar-list page. maxResults=1 lets us finish one calendar's
  // event stream before continuing discovery without storing discovered ID lists.
  directoryPageToken: token.nullable(),
  // Active calendar identity and event continuation survive restart. Clear both
  // only when its final page and nextSyncToken commit with that page's records.
  calendarId: token.nullable(),
  eventPageToken: token.nullable(),
});
export const initialCheckpoint: z.infer<typeof checkpointSchema> = {
  account: null,
  syncTokens: {},
  directoryPageToken: null,
  calendarId: null,
  eventPageToken: null,
};
export const identitySchema = z.object({ id: token });
export const directorySchema = z.object({
  items: z.array(z.object({ id: token })).default([]),
  nextPageToken: token.optional(),
});
