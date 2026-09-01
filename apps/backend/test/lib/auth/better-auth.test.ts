import { describe, expect, test } from 'bun:test';
import { createAuth, mcpServerUrl } from '#lib/auth/better-auth.ts';
import { OWNER_DISPLAY_NAME } from '#lib/auth/owner-registration.ts';
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
