import { SourceHttpError, type SyncContext } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { z } from 'zod';
import { GMAIL_ERRORS } from './models.ts';

const NOT_FOUND = 404;
const BAD_REQUEST = 400;
const OK = 200;
export class GmailNotFound extends SourceHttpError {
  constructor() {
    super({ status: 404 });
  }
}
export class GmailResyncRequired extends SourceHttpError {
  override readonly code = GMAIL_ERRORS.resyncRequired;
  constructor() {
    super({ status: 410 });
    this.message =
      'Gmail rejected its saved sync position. Explicit historical reprocessing is required.';
  }
}
export class GmailLabelMissing extends SourceHttpError {
  override readonly code = GMAIL_ERRORS.labelMissing;
  constructor() {
    super({ status: 400 });
    this.message = 'Create the context-use Gmail label before syncing.';
  }
}
export class GmailMailboxChanged extends SourceHttpError {
  override readonly code = GMAIL_ERRORS.mailboxChanged;
  constructor() {
    super({ status: 400 });
    this.message = 'The connected Gmail mailbox changed. Reconnect the original mailbox.';
  }
}
const rejectedRequest = z.object({
  code: z.literal('connector_request_failed'),
  diagnostics: z.object({
    service: z.literal('gmail'),
    operation: z.string(),
    providerStatus: z.number(),
  }),
});
function failure(input: { status: number; path: string; query?: JsonObject }): never {
  if (
    input.path === '/users/me/history' &&
    (input.status === NOT_FOUND || input.status === BAD_REQUEST)
  ) {
    throw new GmailResyncRequired();
  }
  if (input.query?.pageToken && input.status === BAD_REQUEST) {
    throw new GmailResyncRequired();
  }
  if (input.status === NOT_FOUND) {
    throw new GmailNotFound();
  }
  throw new SourceHttpError({ status: input.status });
}
export async function request(input: { context: SyncContext; path: string; query?: JsonObject }) {
  input.context.signal.throwIfAborted();
  const response = await input.context.provider
    .get({ path: input.path, query: input.query })
    .catch((error: unknown) => {
      const parsed = rejectedRequest.safeParse(error);
      if (parsed.success && parsed.data.diagnostics.operation === input.path) {
        return failure({ ...input, status: parsed.data.diagnostics.providerStatus });
      }
      throw error;
    });
  input.context.signal.throwIfAborted();
  if (response.status !== OK) {
    failure({ ...input, status: response.status });
  }
  return response.body;
}
