import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsQueryKey, type UpdateAssetVariables, updateAsset } from '../../queries/assets';
import { historyQueryKey } from '../../queries/history';
import { knowledgeSuggestionsQueryKey } from '../../queries/knowledge-suggestions';
import { mapQueryKey } from '../../queries/map';

export function useUpdateAsset(): UseMutationResult<void, Error, UpdateAssetVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAsset,
    onSuccess: async () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: historyQueryKey }),
        queryClient.invalidateQueries({ queryKey: assetsQueryKey }),
        queryClient.invalidateQueries({ queryKey: mapQueryKey }),
        queryClient.invalidateQueries({ queryKey: knowledgeSuggestionsQueryKey }),
      ]),
  });
}
