import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsQueryKey, type UpdateAssetVariables, updateAsset } from '../../queries/assets';

export function useUpdateAsset(): UseMutationResult<void, Error, UpdateAssetVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAsset,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: assetsQueryKey }),
  });
}
