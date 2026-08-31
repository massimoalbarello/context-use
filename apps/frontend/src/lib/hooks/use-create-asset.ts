import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsQueryKey, type CreateAssetVariables, createAsset } from '../../queries/assets';

export function useCreateAsset(): UseMutationResult<
  { readableId: string },
  Error,
  CreateAssetVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAsset,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: assetsQueryKey }),
  });
}
