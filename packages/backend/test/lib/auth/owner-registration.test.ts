import { describe, expect, test } from 'bun:test';
import {
  authorizeOwnerPasskeyRegistration,
  OWNER_DISPLAY_NAME,
  OWNER_USER_ID,
  OwnerRegistrationError,
  ownerRegistrationStatus,
  ownerRegistrationUser,
} from '#lib/auth/owner-registration.ts';

function expectOwnerRegistrationError({
  action,
  code,
}: {
  action: () => unknown;
  code: OwnerRegistrationError['code'];
}): void {
  try {
    action();
    throw new Error('Expected owner registration to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(OwnerRegistrationError);
    expect((error as OwnerRegistrationError).code).toBe(code);
  }
}

describe('ownerRegistrationUser', () => {
  test('resolves the unclaimed owner with a fixed authentication identity', () => {
    expect(ownerRegistrationUser({ ownerExists: false })).toEqual({
      id: OWNER_USER_ID,
      name: OWNER_USER_ID,
      displayName: OWNER_DISPLAY_NAME,
    });
  });

  test('rejects already-claimed registration', () => {
    expectOwnerRegistrationError({
      action: () => ownerRegistrationUser({ ownerExists: true }),
      code: 'owner_already_registered',
    });
  });
});

describe('ownerRegistrationStatus', () => {
  test('distinguishes valid registration states and rejects partial registration', () => {
    expect(ownerRegistrationStatus({ ownerExists: false, passkeyExists: false })).toEqual({
      ownerRegistered: false,
    });
    expect(ownerRegistrationStatus({ ownerExists: true, passkeyExists: true })).toEqual({
      ownerRegistered: true,
    });

    for (const state of [
      { ownerExists: true, passkeyExists: false },
      { ownerExists: false, passkeyExists: true },
    ]) {
      expectOwnerRegistrationError({
        action: () => ownerRegistrationStatus(state),
        code: 'owner_registration_state_invalid',
      });
    }
  });
});

describe('authorizeOwnerPasskeyRegistration', () => {
  test('allows the verified owner registration paths', () => {
    expect(
      authorizeOwnerPasskeyRegistration({
        ownerExists: false,
        sessionUserId: undefined,
        userVerified: true,
      }),
    ).toBe('create-owner');
    expect(
      authorizeOwnerPasskeyRegistration({
        ownerExists: true,
        sessionUserId: OWNER_USER_ID,
        userVerified: true,
      }),
    ).toBe('add-passkey');
  });

  test('rejects races, invalid sessions, and missing user verification', () => {
    const cases = [
      {
        action: () =>
          authorizeOwnerPasskeyRegistration({
            ownerExists: true,
            sessionUserId: undefined,
            userVerified: true,
          }),
        code: 'owner_already_registered' as const,
      },
      {
        action: () =>
          authorizeOwnerPasskeyRegistration({
            ownerExists: false,
            sessionUserId: 'another-user',
            userVerified: true,
          }),
        code: 'owner_registration_state_invalid' as const,
      },
      {
        action: () =>
          authorizeOwnerPasskeyRegistration({
            ownerExists: false,
            sessionUserId: undefined,
            userVerified: false,
          }),
        code: 'user_verification_required' as const,
      },
    ];

    for (const registrationCase of cases) {
      expectOwnerRegistrationError(registrationCase);
    }
  });
});
