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
      'Then restart Context Use and try again. If you already have a passkey, try signing in at the original address.',
    ].join('\n\n');
  }

  return error.message ?? fallback;
}
