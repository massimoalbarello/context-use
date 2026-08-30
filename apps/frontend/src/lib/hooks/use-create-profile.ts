import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
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
    onSuccess: (profile) => {
      queryClient.setQueryData(profileQueryKey, profile);
    },
  });
}
