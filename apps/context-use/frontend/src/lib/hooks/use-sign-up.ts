import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionQueryOptions } from '../../queries/session';
import { authClient } from '../auth';
import { clearRememberedKnowledgeResources } from '../knowledge-navigation';
import { passkeyRegistrationErrorMessage } from '../passkey-registration-error';

export function useSignUp(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await authClient.passkey.addPasskey({
        createSession: true,
        name: 'Primary passkey',
      });
      if (error) {
        throw new Error(passkeyRegistrationErrorMessage({ error, origin: window.location.origin }));
      }
    },
    onSuccess: async () => {
      clearRememberedKnowledgeResources(window.sessionStorage);
      queryClient.clear();
      await queryClient.fetchQuery(sessionQueryOptions);
    },
  });
}
