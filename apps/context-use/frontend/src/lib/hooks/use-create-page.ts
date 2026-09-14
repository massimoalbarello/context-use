import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetDetailsQueryKey, assetPreviewsQueryKey } from '../../queries/assets';
import { entitiesQueryKey } from '../../queries/entities';
import { knowledgeSuggestionsQueryKey } from '../../queries/knowledge-suggestions';
import { mapQueryKey } from '../../queries/map';
import { type CreatePageVariables, createPage, pagesQueryKey } from '../../queries/pages';
import { recordDetailsQueryKey } from '../../queries/records';

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
        queryClient.invalidateQueries({ queryKey: recordDetailsQueryKey }),
        queryClient.invalidateQueries({ queryKey: mapQueryKey }),
        queryClient.invalidateQueries({ queryKey: knowledgeSuggestionsQueryKey }),
        queryClient.invalidateQueries({ queryKey: entitiesQueryKey }),
        queryClient.invalidateQueries({ queryKey: assetDetailsQueryKey }),
        queryClient.invalidateQueries({ queryKey: assetPreviewsQueryKey }),
      ]);
    },
  });
}
