import { SourceHttpError, type SyncContext } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { z } from 'zod';

const errorsSchema = z.object({ errors: z.array(z.object({ type: z.string().optional() })) });
const HTTP_OK = 200;
const FORBIDDEN = 403;
const RATE_LIMITED = 429;

export async function postGithubGraphql(input: { context: SyncContext; body: JsonObject }) {
  input.context.signal.throwIfAborted();
  // The engine-bound provider owns credentials, capability checks, and transport cancellation.
  const response = await input.context.provider.post({ path: '/graphql', body: input.body });
  input.context.signal.throwIfAborted();
  const headers = new Headers(response.headers);
  const errors = errorsSchema.safeParse(response.body);
  const types = errors.success ? errors.data.errors.map((error) => error.type) : [];
  if (
    response.status === RATE_LIMITED ||
    ((response.status === FORBIDDEN || types.length > 0) &&
      (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after'))) ||
    types.includes('RATE_LIMITED')
  ) {
    throw new SourceHttpError({ status: RATE_LIMITED });
  }
  if (response.status !== HTTP_OK) {
    throw new SourceHttpError(response);
  }
  if (types.includes('FORBIDDEN')) {
    throw new SourceHttpError({ status: FORBIDDEN });
  }
  return response;
}
