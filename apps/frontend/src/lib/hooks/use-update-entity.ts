import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { entitiesQueryKey, type UpdateEntityVariables, updateEntity } from '../../queries/entities';
import { knowledgeMapQueryKey } from '../../queries/knowledge-map';
import { pagesQueryKey } from '../../queries/pages';
import { profileQueryKey } from '../../queries/profile';

export function useUpdateEntity(): UseMutationResult<void, Error, UpdateEntityVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateEntity,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: entitiesQueryKey }),
        queryClient.invalidateQueries({ queryKey: knowledgeMapQueryKey }),
        queryClient.invalidateQueries({ queryKey: pagesQueryKey }),
        queryClient.invalidateQueries({ queryKey: profileQueryKey }),
      ]);
    },
  });
}
