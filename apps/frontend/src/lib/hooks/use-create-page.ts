import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetDetailsQueryKey } from '../../queries/assets';
import { entitiesQueryKey } from '../../queries/entities';
import { knowledgeMapQueryKey } from '../../queries/knowledge-map';
import { type CreatePageVariables, createPage, pagesQueryKey } from '../../queries/pages';

export function useCreatePage(): UseMutationResult<
  { readableId: string },
  Error,
  CreatePageVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPage,
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
