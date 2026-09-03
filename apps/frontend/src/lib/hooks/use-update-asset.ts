import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsQueryKey, type UpdateAssetVariables, updateAsset } from '../../queries/assets';
import { hypermediaQueryKey } from '../../queries/hypermedia';

export function useUpdateAsset(): UseMutationResult<void, Error, UpdateAssetVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAsset,
    onSuccess: async () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: assetsQueryKey }),
        queryClient.invalidateQueries({ queryKey: hypermediaQueryKey }),
      ]),
  });
}
