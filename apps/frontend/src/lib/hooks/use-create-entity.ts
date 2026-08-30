import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { type CreateEntityVariables, createEntity, entitiesQueryKey } from '../../queries/entities';

export function useCreateEntity(): UseMutationResult<
  { readableId: string },
  Error,
  CreateEntityVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createEntity,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: entitiesQueryKey });
    },
  });
}
