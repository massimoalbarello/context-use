import { SourceHttpError, type SyncContext } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { z } from 'zod';

const badRequest = 400;
export class ExpiredPageToken extends Error {
  constructor(readonly path: string) {
    super('YouTube page token expired.');
  }
}
export class PlaylistNotFound extends Error {}
// 410 pauses acquisition instead of retrying an unusable checkpoint forever.
// The public code remains actionable when a host hides exception messages.
export class ResetRequired extends SourceHttpError {
  override readonly code = 'youtube_checkpoint_invalid_resync_required';
  constructor(message: string) {
    const gone = 410;
    super({ status: gone });
    this.message = message;
  }
}
const errorSchema = z.object({
  error: z.object({ errors: z.array(z.object({ reason: z.string() })) }),
});
const rejectedRequestSchema = z.object({
  code: z.literal('connector_request_failed'),
  diagnostics: z.object({
    service: z.literal('youtube'),
    operation: z.literal('/youtube/v3/playlistItems'),
    providerStatus: z.literal(badRequest),
  }),
});

export async function request(input: { context: SyncContext; path: string; query: JsonObject }) {
  input.context.signal.throwIfAborted();
  const response = await input.context.provider
    .get({ path: input.path, query: input.query })
    .catch((error: unknown) => {
      // Connector's YouTube proxy withholds provider error bodies. A rejected
      // saved item-page request cannot prove token expiry, so stop for explicit
      // recovery rather than inventing a cursor or automatically replaying history.
      if (input.query.pageToken && rejectedRequestSchema.safeParse(error).success) {
        throw new ResetRequired(
          'YouTube rejected the saved item page. Resync explicitly to backfill again.',
        );
      }
      throw error;
    });
  input.context.signal.throwIfAborted();
  const ok = 200;
  const forbidden = 403;
  const notFound = 404;
  const rateLimited = 429;
  const errors = errorSchema.safeParse(response.body);
  const reasons = errors.success ? errors.data.error.errors.map((error) => error.reason) : [];
  if (
    response.status === badRequest &&
    input.query.pageToken &&
    reasons.includes('invalidPageToken')
  ) {
    throw new ExpiredPageToken(input.path);
  }
  if (response.status === notFound && reasons.includes('playlistNotFound')) {
    throw new PlaylistNotFound();
  }
  if (
    response.status === forbidden &&
    reasons.some((reason) =>
      ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded'].includes(reason),
    )
  ) {
    throw new SourceHttpError({ status: rateLimited });
  }
  if (response.status !== ok) {
    throw new SourceHttpError(response);
  }
  return response.body;
}
