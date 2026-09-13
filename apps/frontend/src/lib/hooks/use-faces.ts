import { useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsQueryKey } from '../../queries/assets';
import { entitiesQueryKey } from '../../queries/entities';
import {
  analyzeAsset,
  annotateFace,
  facesQueryKey,
  retryNextImage,
  saveFaceThreshold,
} from '../../queries/faces';

function useFaceMutation<Input, Output>(mutationFn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: facesQueryKey }),
        queryClient.invalidateQueries({ queryKey: assetsQueryKey }),
        queryClient.invalidateQueries({ queryKey: entitiesQueryKey }),
      ]);
    },
  });
}
export function useAnalyzeAsset() {
  return useFaceMutation(analyzeAsset);
}
export function useAnnotateFace() {
  return useFaceMutation(annotateFace);
}
export function useSaveFaceThreshold() {
  return useFaceMutation(saveFaceThreshold);
}
export function useRetryNextImage() {
  return useFaceMutation(retryNextImage);
}
