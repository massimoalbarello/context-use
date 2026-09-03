import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetDetailsQueryKey, assetPreviewsQueryKey } from '../../queries/assets';
import { entitiesQueryKey } from '../../queries/entities';
import { hypermediaQueryKey } from '../../queries/hypermedia';
import { pagesQueryKey, type UpdatePageVariables, updatePage } from '../../queries/pages';

export function useUpdatePage(): UseMutationResult<void, Error, UpdatePageVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updatePage,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pagesQueryKey }),
        queryClient.invalidateQueries({ queryKey: hypermediaQueryKey }),
        queryClient.invalidateQueries({ queryKey: entitiesQueryKey }),
        queryClient.invalidateQueries({ queryKey: assetDetailsQueryKey }),
        queryClient.invalidateQueries({ queryKey: assetPreviewsQueryKey }),
      ]);
    },
  });
}
