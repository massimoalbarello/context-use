import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { entitiesQueryKey } from '../../queries/entities';
import {
  type CreateProfileVariables,
  createProfile,
  type KnowledgeProfile,
  profileQueryKey,
} from '../../queries/profile';

export function useCreateProfile(): UseMutationResult<
  KnowledgeProfile,
  Error,
  CreateProfileVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProfile,
    onSuccess: async (profile) => {
      queryClient.setQueryData(profileQueryKey, profile);
      await queryClient.invalidateQueries({ queryKey: entitiesQueryKey });
    },
  });
}
