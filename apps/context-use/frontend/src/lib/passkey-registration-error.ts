export function passkeyRegistrationErrorMessage({
  error,
  origin,
}: {
  error: { code?: string; message?: string };
  origin: string;
}): string {
  if (
    error.code === 'ERROR_INVALID_RP_ID' ||
    error.message === "'rp.id' cannot be used with the current origin"
  ) {
    return [
      'Passkeys are configured for a different domain.',
      'If you are setting up a custom domain, set the app’s BASE_URL environment variable to:',
      origin,
      'Then restart the app and try creating your account again.',
    ].join('\n\n');
  }

  return error.message ?? 'Could not create your passkey.';
}
