import { describe, expect, test } from 'bun:test';
import { createAuth } from '#lib/auth/better-auth.ts';
import { withAuthTestDatabase } from './auth-test-database.ts';

const AUTH_ORIGIN = 'http://localhost:3000';
const BAD_REQUEST_STATUS = 400;
const OK_STATUS = 200;
const TEST_SECRET = 'test-secret-at-least-thirty-two-characters';

describe('passkey-only authentication', () => {
  test('generates first-owner registration options with required verification', async () => {
    await withAuthTestDatabase({
      run: async (database) => {
        const auth = createAuth({
          database,
          baseUrl: new URL(AUTH_ORIGIN),
          secret: TEST_SECRET,
        });
        const response = await auth.handler(
          new Request(
            `${AUTH_ORIGIN}/api/auth/passkey/generate-register-options?context=Test%20Owner&name=Primary%20passkey`,
            { headers: { origin: AUTH_ORIGIN } },
          ),
        );

        expect(response.status).toBe(OK_STATUS);
        expect(response.headers.get('set-cookie')).toContain('better-auth-passkey');
        expect(await response.json()).toMatchObject({
          rp: { name: 'Context Use', id: 'localhost' },
          user: { name: 'Primary passkey', displayName: 'Test Owner' },
          authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'required',
          },
        });
      },
    });
  });

  test('keeps email and password signup and sign-in disabled', async () => {
    await withAuthTestDatabase({
      run: async (database) => {
        const auth = createAuth({
          database,
          baseUrl: new URL(AUTH_ORIGIN),
          secret: TEST_SECRET,
        });
        const request = (path: string) =>
          auth.handler(
            new Request(`${AUTH_ORIGIN}/api/auth/${path}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', origin: AUTH_ORIGIN },
              body: JSON.stringify({
                name: 'Password user',
                email: 'password-user@example.com',
                password: 'not-a-real-password',
              }),
            }),
          );

        const signUpResponse = await request('sign-up/email');
        const signInResponse = await request('sign-in/email');

        expect(signUpResponse.status).toBe(BAD_REQUEST_STATUS);
        expect(await signUpResponse.json()).toMatchObject({
          code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED',
        });
        expect(signInResponse.status).toBe(BAD_REQUEST_STATUS);
        expect(await signInResponse.json()).toMatchObject({ code: 'EMAIL_PASSWORD_DISABLED' });
      },
    });
  });
});
