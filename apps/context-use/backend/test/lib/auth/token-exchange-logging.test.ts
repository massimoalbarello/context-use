import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { logTokenExchanges } from '#backend/lib/auth/token-exchange-logging.ts';
import { createLogger } from '#backend/lib/logger.ts';
import { createRequestLogger } from '#backend/lib/request-logger.ts';
import { createRequestResponsePlugin } from '#backend/lib/request-response.ts';
import { captureLogs } from '../../support/logging.ts';

const TOKEN_PATH = '/api/auth/oauth2/token';
const ORIGIN = 'http://localhost';
const BAD_REQUEST = 400;
const SERVER_ERROR = 503;
const OVERSIZED_BODY_LENGTH = 20_000;

function tokenRequest({
  json = false,
  body = { grant_type: 'refresh_token', client_id: 'codex', refresh_token: 'private-refresh' },
}: {
  json?: boolean;
  body?: Record<string, string>;
} = {}) {
  return new Request(`${ORIGIN}${TOKEN_PATH}?secret=private-query`, {
    method: 'POST',
    headers: {
      'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded',
      authorization: 'Bearer private-header',
      cookie: 'session=private-cookie',
      'x-request-id': 'untrusted-client-id',
    },
    body: json ? JSON.stringify(body) : new URLSearchParams(body),
  });
}

for (const json of [false, true]) {
  test(`correlates token and HTTP outcomes without consuming or logging credentials (${json ? 'JSON' : 'form'})`, async () => {
    const logs = captureLogs();
    const requestLogger = createRequestLogger(logs.logger);
    const responseBody = { access_token: 'private-access', refresh_token: 'private-rotated' };
    const handler = logTokenExchanges({
      requestLogger,
      tokenPath: TOKEN_PATH,
      handler: async (request) => {
        const body = json ? await request.json() : Object.fromEntries(await request.formData());
        expect(body.refresh_token).toBe('private-refresh');
        return Response.json(responseBody, { headers: { 'set-cookie': 'private-response' } });
      },
    });
    const app = new Elysia()
      .use(createRequestResponsePlugin({ requestLogger }))
      .post(TOKEN_PATH, ({ request }) => handler(request), { parse: 'none' });
    const response = await app.handle(tokenRequest({ json }));
    expect(await response.json()).toEqual(responseBody);
    expect(response.headers.get('set-cookie')).toBe('private-response');
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toBeString();
    expect(requestId).not.toBe('untrusted-client-id');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logs.records()).toEqual([
      expect.objectContaining({
        requestId,
        event: 'oauth.token_exchange.started',
        grantType: 'refresh_token',
        oauthClientId: 'codex',
      }),
      expect.objectContaining({
        requestId,
        event: 'oauth.token_exchange.completed',
        outcome: 'succeeded',
        status: 200,
        durationMs: expect.any(Number),
      }),
      expect.objectContaining({
        requestId,
        event: 'http.request.completed',
        status: 200,
        path: TOKEN_PATH,
      }),
    ]);
    expect(logs.lines.join('')).not.toContain('private-');
  });
}

for (const status of [BAD_REQUEST, SERVER_ERROR]) {
  test(`records the actual failure status and only the OAuth error code (${status})`, async () => {
    const logs = captureLogs();
    const requestLogger = createRequestLogger(logs.logger);
    const body = {
      error: 'invalid_grant',
      error_description: 'private-error-description',
      token: 'private-token',
    };
    const handler = logTokenExchanges({
      requestLogger,
      tokenPath: TOKEN_PATH,
      handler: async () => Response.json(body, { status }),
    });
    const app = new Elysia()
      .use(createRequestResponsePlugin({ requestLogger }))
      .post(TOKEN_PATH, ({ request }) => handler(request), { parse: 'none' });
    const response = await app.handle(tokenRequest());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(logs.records()).toContainEqual(
      expect.objectContaining({
        event: 'oauth.token_exchange.completed',
        status,
        oauthError: 'invalid_grant',
        outcome: 'failed',
        level: status === SERVER_ERROR ? 'error' : 'warn',
      }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logs.records()).toContainEqual(
      expect.objectContaining({ event: 'http.request.completed', status }),
    );
    expect(logs.lines.join('')).not.toContain('private-');
  });
}

test('keeps concurrent request contexts separate', async () => {
  const logs = captureLogs();
  const requestLogger = createRequestLogger(logs.logger);
  const handler = logTokenExchanges({
    requestLogger,
    tokenPath: TOKEN_PATH,
    handler: async () => Response.json({}),
  });
  await Promise.all(
    ['first', 'second'].map((client_id) =>
      handler(tokenRequest({ body: { grant_type: 'refresh_token', client_id } })),
    ),
  );
  const completed = logs
    .records()
    .filter((record) => record.event === 'oauth.token_exchange.completed');
  expect(completed.map((record) => record.oauthClientId).sort()).toEqual(['first', 'second']);
  expect(new Set(completed.map((record) => record.requestId)).size).toBe(2);
});

test('preserves malformed and oversized requests and omits unrecognized metadata', async () => {
  const logs = captureLogs();
  const bodies = [
    '{private-malformed',
    JSON.stringify({
      grant_type: 'refresh_token',
      client_id: 'codex',
      padding: 'x'.repeat(OVERSIZED_BODY_LENGTH),
    }),
  ];
  const handler = logTokenExchanges({
    requestLogger: createRequestLogger(logs.logger),
    tokenPath: TOKEN_PATH,
    handler: async (request) => new Response(await request.text(), { status: BAD_REQUEST }),
  });
  for (const body of bodies) {
    const response = await handler(
      new Request(`${ORIGIN}${TOKEN_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );
    expect(await response.text()).toBe(body);
  }
  expect(
    logs.records().filter((record) => record.event === 'oauth.token_exchange.completed'),
  ).toEqual([
    expect.objectContaining({ grantType: 'unknown', oauthError: 'unknown_error' }),
    expect.objectContaining({ grantType: 'unknown', oauthError: 'unknown_error' }),
  ]);
  expect(logs.lines.join('')).not.toContain('private-');
});

test('logs exceptions without their potentially sensitive message and rethrows the same error', async () => {
  const logs = captureLogs();
  const error = new Error('private-exception');
  const handler = logTokenExchanges({
    requestLogger: createRequestLogger(logs.logger),
    tokenPath: TOKEN_PATH,
    handler: () => Promise.reject(error),
  });
  await expect(handler(tokenRequest())).rejects.toBe(error);
  expect(logs.records()).toContainEqual(
    expect.objectContaining({
      event: 'oauth.token_exchange.failed',
      outcome: 'exception',
      level: 'error',
    }),
  );
  expect(logs.lines.join('')).not.toContain('private-');
});

test('passes other authentication requests through without inspecting their bodies', async () => {
  const logs = captureLogs();
  const request = new Request(`${ORIGIN}/api/auth/passkey/verify-registration`, {
    method: 'POST',
    body: 'private-passkey',
  });
  const handler = logTokenExchanges({
    requestLogger: createRequestLogger(logs.logger),
    tokenPath: TOKEN_PATH,
    handler: async (input) => new Response(await input.text()),
  });
  expect(await (await handler(request)).text()).toBe('private-passkey');
  expect(logs.lines).toEqual([]);
});

test('a failing log destination cannot interrupt token issuance', async () => {
  const logger = createLogger({
    destination: {
      write: () => {
        throw new Error('Sink unavailable');
      },
    },
  });
  const handler = logTokenExchanges({
    requestLogger: createRequestLogger(logger),
    tokenPath: TOKEN_PATH,
    handler: () => Promise.resolve(Response.json({ access_token: 'private-access' })),
  });
  expect(await (await handler(tokenRequest())).json()).toEqual({ access_token: 'private-access' });
});
