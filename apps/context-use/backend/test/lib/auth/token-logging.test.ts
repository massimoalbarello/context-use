import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuth } from '#backend/lib/auth/better-auth.ts';
import { createRequestLogger } from '#backend/lib/request-logger.ts';
import { createRequestResponsePlugin } from '#backend/lib/request-response.ts';
import { captureLogs } from '../../support/logging.ts';
import { withAuthTestDatabase } from './auth-test-database.ts';

const ORIGIN = 'http://localhost';
const BAD_REQUEST = 400;
const TEST_SECRET = 'test-secret-at-least-thirty-two-characters';

const cases: { body: Record<string, string>; grantType: string; errorCode: string }[] = [
  {
    body: {
      grant_type: 'refresh_token',
      client_id: 'codex',
      refresh_token: 'private-refresh-token',
    },
    grantType: 'refresh_token',
    errorCode: 'invalid_grant',
  },
  {
    body: { refresh_token: 'private-refresh-token' },
    grantType: 'other',
    errorCode: 'invalid_request',
  },
];

for (const { body, grantType, errorCode } of cases) {
  test(`logs one safe token outcome correlated with HTTP logging (${errorCode})`, async () => {
    await withAuthTestDatabase({
      run: async (database) => {
        const logs = captureLogs();
        const requestLogger = createRequestLogger(logs.logger);
        const auth = createAuth({
          requestLogger,
          database,
          baseUrl: new URL(ORIGIN),
          secret: TEST_SECRET,
          getMcpAuthorizationId: async () => null,
          fetchClientMetadataResource: async () => new Response(null, { status: BAD_REQUEST }),
        });
        const app = new Elysia()
          .use(createRequestResponsePlugin({ requestLogger }))
          .all('/api/auth/*', ({ request }) => auth.handler(request), { parse: 'none' });
        const response = await app.handle(
          new Request(`${ORIGIN}/api/auth/oauth2/token?secret=private-query`, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              cookie: 'session=private-cookie',
              'x-request-id': 'untrusted-client-id',
            },
            body: new URLSearchParams(body),
          }),
        );
        expect(response.status).toBe(BAD_REQUEST);
        expect(await response.json()).toMatchObject({ error: errorCode });
        await new Promise<void>((resolve) => setImmediate(resolve));
        const requestId = response.headers.get('x-request-id');
        expect(requestId).toBeString();
        expect(requestId).not.toBe('untrusted-client-id');
        expect(
          logs.records().filter((record) => record.event === 'oauth.token_exchange.completed'),
        ).toEqual([
          expect.objectContaining({
            requestId,
            grantType,
            status: BAD_REQUEST,
            oauthError: errorCode,
            level: 'warn',
          }),
        ]);
        expect(logs.records()).toContainEqual(
          expect.objectContaining({
            requestId,
            event: 'http.request.completed',
            status: BAD_REQUEST,
            durationMs: expect.any(Number),
          }),
        );
        await app.handle(new Request(`${ORIGIN}/api/auth/get-session`));
        expect(
          logs.records().filter((record) => record.event === 'oauth.token_exchange.completed'),
        ).toHaveLength(1);
        expect(logs.lines.join('')).not.toContain('private-');
      },
    });
  });
}
