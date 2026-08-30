import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { authClient } from '../auth';

export function useSignIn(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signIn.passkey();
      if (error) {
        throw new Error(error.message ?? 'Could not sign in with your passkey.');
      }
    },
    onSuccess: async () => {
      queryClient.clear();
      await router.invalidate();
    },
  });
}
