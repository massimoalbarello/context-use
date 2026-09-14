import { expect, test } from 'bun:test';
import { passkeyRegistrationErrorMessage } from '../src/lib/passkey-registration-error';

test.each([
  { code: 'ERROR_INVALID_RP_ID', message: 'Browser-specific error wording' },
  { code: 'UNKNOWN_ERROR', message: "'rp.id' cannot be used with the current origin" },
])('explains how to fix a passkey domain mismatch: $code', (error) => {
  const message = passkeyRegistrationErrorMessage({ error });

  expect(message).toContain('Passkeys are configured for a different domain.');
  expect(message).toContain('BASE_URL environment variable');
  expect(message).toContain('full URL of your desired custom domain (including https://)');
  expect(message).toContain('restart the app');
  expect(message).not.toContain(error.message);
});

test('preserves unrelated errors instead of suggesting a domain change', () => {
  const message = 'Registration cancelled';
  expect(passkeyRegistrationErrorMessage({ error: { code: 'AUTH_CANCELLED', message } })).toBe(
    message,
  );
});

test('supplies a fallback when registration fails without a message', () => {
  expect(passkeyRegistrationErrorMessage({ error: {} })).toBe('Could not create your passkey.');
});
