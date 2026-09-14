import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionQueryOptions } from '../../queries/session';
import { authClient } from '../auth';
import { passkeyErrorMessage } from '../passkey-error';

export function useSignUp(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await authClient.passkey.addPasskey({
        createSession: true,
        name: 'Primary passkey',
      });
      if (error) {
        throw new Error(passkeyErrorMessage({ error, fallback: 'Could not create your passkey.' }));
      }
    },
    onSuccess: async () => {
      queryClient.clear();
      await queryClient.fetchQuery(sessionQueryOptions);
    },
  });
}
