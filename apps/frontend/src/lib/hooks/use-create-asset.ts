import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsQueryKey, type CreateAssetVariables, createAsset } from '../../queries/assets';
import { facesQueryKey } from '../../queries/faces';

export function useCreateAsset(): UseMutationResult<
  { readableId: string },
  Error,
  CreateAssetVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAsset,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: assetsQueryKey }),
        queryClient.invalidateQueries({ queryKey: facesQueryKey }),
      ]);
    },
  });
}
