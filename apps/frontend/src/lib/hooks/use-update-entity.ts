import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { entitiesQueryKey, type UpdateEntityVariables, updateEntity } from '../../queries/entities';

export function useUpdateEntity(): UseMutationResult<void, Error, UpdateEntityVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateEntity,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: entitiesQueryKey });
    },
  });
}
