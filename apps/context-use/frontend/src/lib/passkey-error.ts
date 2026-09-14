export function passkeyErrorMessage({
  error,
  fallback,
}: {
  error: { code?: string; message?: string };
  fallback: string;
}): string {
  if (
    error.code === 'ERROR_INVALID_RP_ID' ||
    error.message === "'rp.id' cannot be used with the current origin"
  ) {
    return [
      'Your browser could not use a passkey on this domain.',
      'If you are setting up a custom domain, set the app’s BASE_URL environment variable to the full URL of your desired custom domain (including https://).',
      'Then restart the app and try again. If it is already configured, your browser or passkey provider may not support custom-domain sign-in. On nibrun, use the app’s original .nibrun.app address instead.',
    ].join('\n\n');
  }

  return error.message ?? fallback;
}
