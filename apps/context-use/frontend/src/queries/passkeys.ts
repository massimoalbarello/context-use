import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import { authClient } from '../lib/auth';
import { passkeyErrorMessage } from '../lib/passkey-error';

export const userPasskeysQueryKey = ['user-passkeys'] as const;

export const passkeyOriginsQueryOptions = queryOptions({
  queryKey: ['passkey-origins'],
  queryFn: async () => {
    const { data, error } = await api['.well-known'].webauthn.get();
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});

export const userPasskeysQueryOptions = queryOptions({
  queryKey: userPasskeysQueryKey,
  queryFn: async () => {
    const { data, error } = await authClient.passkey.listUserPasskeys();
    if (error) {
      throw new Error(passkeyErrorMessage({ error, fallback: 'Could not load your passkeys.' }));
    }
    return data ?? [];
  },
});

export async function addPasskey(): Promise<void> {
  const { error } = await authClient.passkey.addPasskey();
  if (error) {
    throw new Error(passkeyErrorMessage({ error, fallback: 'Could not add your passkey.' }));
  }
}

export async function deletePasskey(id: string): Promise<void> {
  const { error } = await authClient.passkey.deletePasskey({ id });
  if (error) {
    throw new Error(passkeyErrorMessage({ error, fallback: 'Could not remove this passkey.' }));
  }
}
