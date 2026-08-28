import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { sessionQueryOptions } from '../../queries/session';
import { authClient } from '../auth';

type SignUpVariables = {
  name: string;
};

export function useSignUp(): UseMutationResult<void, Error, SignUpVariables> {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async ({ name }: SignUpVariables) => {
      const { error } = await authClient.passkey.addPasskey({
        context: name,
        createSession: true,
        name: 'Primary passkey',
      });
      if (error) {
        throw new Error(error.message ?? 'Could not create your passkey.');
      }
    },
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: sessionQueryOptions.queryKey });
      await router.invalidate();
    },
  });
}
