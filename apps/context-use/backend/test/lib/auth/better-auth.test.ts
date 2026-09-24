import { describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { Elysia, StatusMap } from 'elysia';
import { createAuth, mcpServerUrl } from '#backend/lib/auth/better-auth.ts';
import { OWNER_DISPLAY_NAME, OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createAuthController } from '#backend/routes/api/auth/controller.ts';
import { createAuthDiscoveryController } from '#backend/routes/auth-discovery/controller.ts';
import { testPasskey } from '../../support/test-passkey.ts';
import { withAuthTestDatabase } from './auth-test-database.ts';

const AUTH_ORIGIN = 'http://localhost:3000';
const OK_STATUS = 200;
const TEST_SECRET = 'test-secret-at-least-thirty-two-characters';

test('the MCP server URL uses the configured public origin', () => {
  expect(mcpServerUrl({ baseUrl: new URL('https://context-use.nibrun.app/dashboard') })).toBe(
    'https://context-use.nibrun.app/mcp',
  );
});

describe('passkey-only authentication', () => {
  test('generates first-owner registration options with required verification', async () => {
    await withAuthTestDatabase({
      run: async (database) => {
        const auth = createAuth({
          database,
          baseUrl: new URL(AUTH_ORIGIN),
          secret: TEST_SECRET,
          fetchClientMetadataResource: async () => new Response(null, { status: 503 }),
        });
        const response = await auth.handler(
          new Request(
            `${AUTH_ORIGIN}/api/auth/passkey/generate-register-options?name=Primary%20passkey`,
            { headers: { origin: AUTH_ORIGIN } },
          ),
        );

        expect(response.status).toBe(OK_STATUS);
        expect(response.headers.get('set-cookie')).toContain('better-auth-passkey');
        expect(await response.json()).toMatchObject({
          rp: { name: 'Context Use', id: 'localhost' },
          user: { name: 'Primary passkey', displayName: OWNER_DISPLAY_NAME },
          authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'required',
          },
        });
      },
    });
  });
});

const NIBRUN_HOSTNAME = 'context-use-test.nibrun.app';
const NIBRUN_ORIGIN = `https://${NIBRUN_HOSTNAME}`;
const CUSTOM_ORIGIN = 'https://knowledge.example.com';
const REPLACEMENT_ORIGIN = 'https://notes.example.org';

function authApp({
  database,
  baseUrl,
  nibrunHostname,
}: {
  database: SQL;
  baseUrl: string;
  nibrunHostname?: string;
}) {
  const auth = createAuth({
    database,
    baseUrl: new URL(baseUrl),
    nibrunHostname,
    secret: TEST_SECRET,
    fetchClientMetadataResource: async () => new Response(null, { status: 503 }),
  });
  return new Elysia()
    .use(createAuthDiscoveryController({ auth }))
    .group('/api', (app) => app.use(createAuthController({ auth })));
}

type AuthApp = ReturnType<typeof authApp>;

function challengeCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

async function register({
  app,
  passkey,
  origin,
}: {
  app: AuthApp;
  passkey: ReturnType<typeof testPasskey>;
  origin: string;
}) {
  const options = await app.handle(
    new Request(`${origin}/api/auth/passkey/generate-register-options?name=Primary%20passkey`, {
      headers: { origin },
    }),
  );
  expect(options.status).toBe(OK_STATUS);
  const body = await options.json();
  expect(body.rp.id).toBe(NIBRUN_HOSTNAME);
  const verification = await app.handle(
    new Request(`${origin}/api/auth/passkey/verify-registration`, {
      method: 'POST',
      headers: { origin, cookie: challengeCookie(options), 'content-type': 'application/json' },
      body: JSON.stringify({
        response: passkey.registration({ origin, challenge: body.challenge }),
        createSession: true,
      }),
    }),
  );
  expect(verification.status).toBe(OK_STATUS);
  expect(
    verification.headers.getSetCookie().some((cookie) => cookie.includes('session_token')),
  ).toBe(true);
}

async function authenticate({
  app,
  passkey,
  origin,
  signedOrigin = origin,
}: {
  app: AuthApp;
  passkey: ReturnType<typeof testPasskey>;
  origin: string;
  signedOrigin?: string;
}) {
  const options = await app.handle(
    new Request(`${origin}/api/auth/passkey/generate-authenticate-options`, {
      headers: { origin },
    }),
  );
  expect(options.status).toBe(OK_STATUS);
  const body = await options.json();
  expect(body.rpId).toBe(NIBRUN_HOSTNAME);
  return app.handle(
    new Request(`${origin}/api/auth/passkey/verify-authentication`, {
      method: 'POST',
      headers: { origin, cookie: challengeCookie(options), 'content-type': 'application/json' },
      body: JSON.stringify({
        response: passkey.authentication({ origin: signedOrigin, challenge: body.challenge }),
      }),
    }),
  );
}

test('a passkey survives adding, replacing and removing a custom domain after signup', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      const passkey = testPasskey(NIBRUN_HOSTNAME);
      await register({
        app: authApp({ database, baseUrl: NIBRUN_ORIGIN, nibrunHostname: NIBRUN_HOSTNAME }),
        passkey,
        origin: NIBRUN_ORIGIN,
      });
      for (const origin of [CUSTOM_ORIGIN, REPLACEMENT_ORIGIN, NIBRUN_ORIGIN]) {
        const app = authApp({ database, baseUrl: origin, nibrunHostname: NIBRUN_HOSTNAME });
        for (const loginOrigin of new Set([origin, NIBRUN_ORIGIN])) {
          const response = await authenticate({ app, passkey, origin: loginOrigin });
          expect(response.status).toBe(OK_STATUS);
          const cookie = challengeCookie(response);
          const session = await app.handle(
            new Request(`${loginOrigin}/api/auth/get-session`, {
              headers: { cookie },
            }),
          );
          expect((await session.json()).user.id).toBe(OWNER_USER_ID);
        }
        const discovery = await app.handle(
          new Request(`${NIBRUN_ORIGIN}/.well-known/webauthn`, {
            headers: {
              origin: 'https://untrusted.example',
              'x-forwarded-host': 'untrusted.example',
            },
          }),
        );
        expect(discovery.status).toBe(OK_STATUS);
        expect(discovery.headers.get('content-type')).toContain('application/json');
        expect(discovery.headers.get('cache-control')).toBe('no-store');
        expect(await discovery.json()).toEqual({ origins: [...new Set([NIBRUN_ORIGIN, origin])] });
      }
      const passkeys = await database<
        { credentialID: string }[]
      >`select "credentialID" from "auth_passkey"`;
      expect(passkeys).toEqual([{ credentialID: passkey.id }]);
    },
  });
});

test('signup on a custom domain produces a passkey that also signs in on the original nibrun domain', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      const app = authApp({ database, baseUrl: CUSTOM_ORIGIN, nibrunHostname: NIBRUN_HOSTNAME });
      const passkey = testPasskey(NIBRUN_HOSTNAME);
      await register({ app, passkey, origin: CUSTOM_ORIGIN });
      expect((await authenticate({ app, passkey, origin: NIBRUN_ORIGIN })).status).toBe(OK_STATUS);
    },
  });
});

test('signed assertions from a removed or unconfigured origin are rejected', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      const passkey = testPasskey(NIBRUN_HOSTNAME);
      await register({
        app: authApp({ database, baseUrl: CUSTOM_ORIGIN, nibrunHostname: NIBRUN_HOSTNAME }),
        passkey,
        origin: CUSTOM_ORIGIN,
      });
      const app = authApp({
        database,
        baseUrl: REPLACEMENT_ORIGIN,
        nibrunHostname: NIBRUN_HOSTNAME,
      });
      for (const signedOrigin of [CUSTOM_ORIGIN, 'https://untrusted.example']) {
        const response = await authenticate({
          app,
          passkey,
          origin: REPLACEMENT_ORIGIN,
          signedOrigin,
        });
        expect(response.status).toBe(StatusMap['Bad Request']);
        expect(await response.json()).toMatchObject({ code: 'AUTHENTICATION_FAILED' });
        expect(
          response.headers.getSetCookie().some((cookie) => cookie.includes('session_token')),
        ).toBe(false);
      }
      const users = await database<{ count: number }[]>`select count(*) as count from "auth_user"`;
      expect(users).toEqual([{ count: 1 }]);
    },
  });
});

test('non-nibrun deployments keep the configured origin as their passkey identity', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      const app = authApp({ database, baseUrl: CUSTOM_ORIGIN });
      const response = await app.handle(
        new Request(`${CUSTOM_ORIGIN}/api/auth/passkey/generate-register-options`, {
          headers: { origin: CUSTOM_ORIGIN },
        }),
      );
      expect((await response.json()).rp.id).toBe(new URL(CUSTOM_ORIGIN).hostname);
      const discovery = await app.handle(new Request(`${CUSTOM_ORIGIN}/.well-known/webauthn`));
      expect(await discovery.json()).toEqual({ origins: [CUSTOM_ORIGIN] });
    },
  });
});
