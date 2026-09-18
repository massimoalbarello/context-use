import type { ProviderResponse, SyncContext } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { z } from 'zod';

const identifier = z
  .string()
  .regex(/^[_a-zA-Z][_a-zA-Z0-9]{0,63}$/)
  .optional()
  .catch(undefined);
const errorDetails = z.object({
  type: identifier,
  extensions: z
    .object({ code: identifier, typeName: identifier, fieldName: identifier })
    .optional()
    .catch(undefined),
});
const responseShape = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.unknown()).optional(),
});
const MAX_LOGGED_ERRORS = 5;
const HTTP_OK = 200;

function responseDetails(response: ProviderResponse): JsonObject {
  const headers = new Headers(response.headers);
  const details: JsonObject = { status: response.status };
  const requestId = headers.get('x-github-request-id');
  if (requestId && /^[a-fA-F0-9:]{1,128}$/.test(requestId)) {
    details.githubRequestId = requestId;
  }
  for (const header of ['x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) {
    const value = headers.get(header);
    if (value && /^\d{1,12}$/.test(value)) {
      details[header] = Number(value);
    }
  }
  const parsed = responseShape.safeParse(response.body);
  const errors = parsed.success ? parsed.data.errors : undefined;
  details.outcome =
    response.status !== HTTP_OK
      ? 'http_error'
      : errors?.length
        ? 'graphql_error'
        : !parsed.success || parsed.data.data == null
          ? 'invalid_response'
          : 'success';
  if (errors?.length) {
    details.errorCount = errors.length;
    // GitHub messages can echo query variables. Keep only bounded schema identifiers.
    details.errors = errors.slice(0, MAX_LOGGED_ERRORS).map((error) => {
      const parsed = errorDetails.safeParse(error);
      return parsed.success
        ? JSON.parse(JSON.stringify({ type: parsed.data.type, ...parsed.data.extensions }))
        : {};
    });
  }
  return details;
}

export async function postGithubGraphql({
  context,
  body,
}: {
  context: SyncContext;
  body: JsonObject;
}) {
  context.signal.throwIfAborted();
  const startedAt = performance.now();
  const fields = {
    requestId: crypto.randomUUID(),
    provider: 'github',
    method: 'POST',
    path: '/graphql',
  };
  context.log({ message: 'github_request_started', fields });
  let response: ProviderResponse;
  try {
    response = await context.provider.post({ path: '/graphql', body });
  } catch (error) {
    context.log({
      message: 'github_request_finished',
      fields: {
        ...fields,
        durationMs: Math.round(performance.now() - startedAt),
        outcome: context.signal.aborted ? 'cancelled' : 'transport_error',
      },
    });
    // Preserve the original failure for the runtime's retry/cancellation handling, without logging it.
    throw error;
  }
  context.log({
    message: 'github_request_finished',
    fields: {
      ...fields,
      durationMs: Math.round(performance.now() - startedAt),
      ...responseDetails(response),
    },
  });
  return response;
}
