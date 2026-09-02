import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetDetailsQueryKey } from '../../queries/assets';
import { entitiesQueryKey } from '../../queries/entities';
import { knowledgeMapQueryKey } from '../../queries/knowledge-map';
import { pagesQueryKey, type UpdatePageVariables, updatePage } from '../../queries/pages';

export function useUpdatePage(): UseMutationResult<void, Error, UpdatePageVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updatePage,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pagesQueryKey }),
        queryClient.invalidateQueries({ queryKey: knowledgeMapQueryKey }),
        queryClient.invalidateQueries({ queryKey: entitiesQueryKey }),
        queryClient.invalidateQueries({ queryKey: assetDetailsQueryKey }),
      ]);
    },
  });
}
