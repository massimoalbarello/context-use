import { SourceHttpError, type SyncContext } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { z } from 'zod';

const gone = 410;
const badRequest = 400;
export class ResetRequired extends SourceHttpError {
  override readonly code = 'googlecalendar_checkpoint_invalid_resync_required';
  constructor() {
    super({ status: gone });
    this.message = 'Google Calendar rejected its saved cursor. Explicit resync is required.';
  }
}
const rejectedRequest = z.object({
  code: z.literal('connector_request_failed'),
  diagnostics: z.object({
    service: z.literal('googlecalendar'),
    operation: z.string(),
    providerStatus: z.number(),
  }),
});
// Expiry requires explicit recovery: the engine has no full-scan reconciliation
// to remove events missing after token expiry. Do not silently replay history or
// claim that an expired feed still observes all cancellations.
function invalidCursor({ query, status }: { query: JsonObject; status: number }) {
  return Boolean(
    (query.syncToken || query.pageToken) &&
      (status === gone || (query.pageToken && status === badRequest)),
  );
}
export async function request(input: { context: SyncContext; path: string; query?: JsonObject }) {
  input.context.signal.throwIfAborted();
  const query = input.query ?? {};
  const response = await input.context.provider
    .get({ path: input.path, query })
    .catch((error: unknown) => {
      const rejected = rejectedRequest.safeParse(error);
      if (
        rejected.success &&
        rejected.data.diagnostics.operation === input.path &&
        invalidCursor({ query, status: rejected.data.diagnostics.providerStatus })
      ) {
        throw new ResetRequired();
      }
      throw error;
    });
  input.context.signal.throwIfAborted();
  if (invalidCursor({ query, status: response.status })) {
    throw new ResetRequired();
  }
  const ok = 200;
  if (response.status !== ok) {
    throw new SourceHttpError(response);
  }
  return response.body;
}
