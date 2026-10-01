import { z } from 'zod';

export const pageSize = 50;
export const checkpointSchema = z.strictObject({
  // Bound YouTube channel identity survives completion; reject a different owner
  // before reading or committing another page under the old sync.
  account: z.string().min(1).nullable(),
  // Per-playlist append frontier, committed with each page: its native request
  // token, starting API position, and count of memberships already emitted. At
  // completion the count gates future polls against the directory's itemCount.
  // The position verifies token reuse and filters old items from the final page.
  // Tokens stay opaque; rejection requires reset rather than archive replay.
  // New entries must be appended in API position order. Removal/reordering and
  // edits outside the tail are not tracked; a detected size decrease requires reset.
  tails: z.record(
    z.string().min(1),
    z.strictObject({
      pageToken: z.string().min(1).nullable(),
      pageOffset: z.number().int().nonnegative(),
      itemCount: z.number().int().nonnegative(),
    }),
  ),
  // Next native playlist-directory page, after the active playlist. Retained while
  // its item pages are unfinished so restart does not repeat directory discovery.
  directoryPageToken: z.string().min(1).nullable(),
  // Only the active resource identity, never a discovered ID list or response body.
  playlistId: z.string().min(1).nullable(),
  // Playlist title is active stream context needed to make complete video records
  // after restart; it is cleared with the active identity when paging finishes.
  playlistTitle: z.string().nullable(),
  // Native continuation inside the active playlist; committed with the complete
  // page's records. Cleared when that playlist is exhausted, but the final page's
  // request token survives in tails for the next poll. Expiry requires explicit reset.
  itemPageToken: z.string().min(1).nullable(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
export const initialCheckpoint: Checkpoint = {
  account: null,
  tails: {},
  directoryPageToken: null,
  playlistId: null,
  playlistTitle: null,
  itemPageToken: null,
};
export const paginationSchema = z.object({
  nextPageToken: z.string().min(1).optional(),
  pageInfo: z.object({ totalResults: z.number().int().nonnegative() }),
});

export function nextPage(input: {
  page: z.infer<typeof paginationSchema>;
  previous: string | null;
  count: number;
}) {
  const next = input.page.nextPageToken ?? null;
  if (next && (next === input.previous || input.count === 0)) {
    throw new Error('YouTube returned incomplete pagination.');
  }
  // Detect a truncated first page; totalResults is not an update token or an
  // invariant across later mutable pages, so do not infer progress from it.
  if (!input.previous && !next && input.page.pageInfo.totalResults > input.count) {
    throw new Error('YouTube omitted a continuation token.');
  }
  return next;
}
