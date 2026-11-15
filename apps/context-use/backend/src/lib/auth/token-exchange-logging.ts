import type { RequestLogger } from '#backend/lib/request-logger.ts';

const MAX_LOG_BODY_BYTES = 16_384;
const SERVER_ERROR_STATUS = 500;
const MAX_CLIENT_ID_LENGTH = 512;
const GRANT_TYPES = new Set(['authorization_code', 'refresh_token', 'client_credentials']);
const OAUTH_ERRORS = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'invalid_target',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
]);

// Logging observes bounded clones; the provider retains the original request and response bodies.
async function logBody(message: Request | Response): Promise<string | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = message.clone().body?.getReader();
    if (!reader) {
      return null;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return Buffer.concat(chunks).toString('utf8');
      }
      size += value.byteLength;
      if (size > MAX_LOG_BODY_BYTES) {
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    // Awaiting cancellation of a tee can wait for the provider to consume the other branch.
    void reader?.cancel().catch(() => {});
  }
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

async function tokenMetadata(request: Request) {
  try {
    const contentType = request.headers.get('content-type')?.split(';')[0]?.trim();
    if (contentType !== 'application/x-www-form-urlencoded' && contentType !== 'application/json') {
      return { grantType: 'unknown' };
    }
    const text = await logBody(request);
    const body =
      text === null
        ? {}
        : contentType === 'application/x-www-form-urlencoded'
          ? Object.fromEntries(new URLSearchParams(text))
          : contentType === 'application/json'
            ? object(JSON.parse(text))
            : {};
    return {
      grantType:
        typeof body.grant_type === 'string' && GRANT_TYPES.has(body.grant_type)
          ? body.grant_type
          : 'unknown',
      // A client identifier is supplied by the caller; it is not an authenticated principal.
      oauthClientId:
        typeof body.client_id === 'string' && body.client_id.length <= MAX_CLIENT_ID_LENGTH
          ? body.client_id
          : undefined,
    };
  } catch {
    return { grantType: 'unknown' };
  }
}

async function oauthError(response: Response): Promise<string | undefined> {
  if (response.ok) {
    return undefined;
  }
  try {
    const text = await logBody(response);
    const error = text === null ? undefined : object(JSON.parse(text)).error;
    return typeof error === 'string' && OAUTH_ERRORS.has(error) ? error : 'unknown_error';
  } catch {
    return 'unknown_error';
  }
}

export function logTokenExchanges({
  handler,
  tokenPath,
  requestLogger,
}: {
  handler: (request: Request) => Promise<Response>;
  tokenPath: string;
  requestLogger: RequestLogger;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST' || new URL(request.url).pathname !== tokenPath) {
      return handler(request);
    }
    const startedAt = performance.now();
    const logger = requestLogger(request).child({ ...(await tokenMetadata(request)) });
    logger.info({ event: 'oauth.token_exchange.started' }, 'OAuth token exchange started');
    let response: Response;
    try {
      response = await handler(request);
    } catch (error) {
      // Provider exceptions and OAuth error descriptions may contain credentials.
      logger.error(
        {
          event: 'oauth.token_exchange.failed',
          outcome: 'exception',
          durationMs: Math.round(performance.now() - startedAt),
        },
        'OAuth token exchange threw an exception',
      );
      throw error;
    }
    const level = response.status >= SERVER_ERROR_STATUS ? 'error' : response.ok ? 'info' : 'warn';
    logger[level](
      {
        event: 'oauth.token_exchange.completed',
        outcome: response.ok ? 'succeeded' : 'failed',
        status: response.status,
        oauthError: await oauthError(response),
        durationMs: Math.round(performance.now() - startedAt),
      },
      'OAuth token exchange completed',
    );
    return response;
  };
}
