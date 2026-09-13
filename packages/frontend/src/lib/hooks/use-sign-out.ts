import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { authClient } from '../auth';
import { clearRememberedKnowledgeResources } from '../knowledge-navigation';

export function useSignOut(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: async () => {
      clearRememberedKnowledgeResources(window.sessionStorage);
      queryClient.clear();
      await router.invalidate();
    },
  });
}
