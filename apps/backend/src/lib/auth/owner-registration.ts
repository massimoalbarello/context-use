export const OWNER_USER_ID = 'context-use-owner';
export const OWNER_SYNTHETIC_EMAIL = 'context-use-owner@context-use.invalid';

export const MAX_OWNER_NAME_LENGTH = 80;

export type OwnerRegistrationPersistenceState = {
  ownerExists: boolean;
  passkeyExists: boolean;
};

export interface OwnerRegistrationRepositoryContract {
  state(): Promise<OwnerRegistrationPersistenceState>;
}

export type OwnerRegistrationErrorCode =
  | 'invalid_owner_name'
  | 'owner_already_registered'
  | 'owner_registration_state_invalid'
  | 'user_verification_required';

const ERROR_MESSAGES: Record<OwnerRegistrationErrorCode, string> = {
  invalid_owner_name: `Enter a name between 1 and ${MAX_OWNER_NAME_LENGTH} characters.`,
  owner_already_registered: 'This Context Use instance already has an owner.',
  owner_registration_state_invalid: 'The owner registration state is invalid.',
  user_verification_required: 'Your authenticator must verify that it is you.',
};

export class OwnerRegistrationError extends Error {
  readonly code: OwnerRegistrationErrorCode;

  constructor(code: OwnerRegistrationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'OwnerRegistrationError';
    this.code = code;
  }
}

export function ownerRegistrationStatus({
  ownerExists,
  passkeyExists,
}: OwnerRegistrationPersistenceState): { ownerRegistered: boolean } {
  if (ownerExists !== passkeyExists) {
    throw new OwnerRegistrationError('owner_registration_state_invalid');
  }
  return { ownerRegistered: ownerExists };
}

export function ownerRegistrationUser({
  context,
  ownerExists,
}: {
  context?: string | null;
  ownerExists: boolean;
}): { id: string; name: string; displayName: string } {
  if (ownerExists) {
    throw new OwnerRegistrationError('owner_already_registered');
  }

  const displayName = context?.trim() ?? '';
  if (displayName.length === 0 || [...displayName].length > MAX_OWNER_NAME_LENGTH) {
    throw new OwnerRegistrationError('invalid_owner_name');
  }

  return {
    id: OWNER_USER_ID,
    // WebAuthn requires a stable username in addition to its opaque byte id. It is not a login
    // identifier in this passkey-only application, so keep it fixed and non-personal.
    name: OWNER_USER_ID,
    displayName,
  };
}

export function authorizeOwnerPasskeyRegistration({
  ownerExists,
  sessionUserId,
  userVerified,
}: {
  ownerExists: boolean;
  sessionUserId?: string;
  userVerified: boolean;
}): 'create-owner' | 'add-passkey' {
  if (!userVerified) {
    throw new OwnerRegistrationError('user_verification_required');
  }

  if (ownerExists) {
    if (sessionUserId !== OWNER_USER_ID) {
      throw new OwnerRegistrationError('owner_already_registered');
    }
    return 'add-passkey';
  }

  if (sessionUserId) {
    throw new OwnerRegistrationError('owner_registration_state_invalid');
  }

  return 'create-owner';
}
