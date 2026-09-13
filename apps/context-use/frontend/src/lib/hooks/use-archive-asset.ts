import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ArchiveAssetResult, archiveAsset } from '../../queries/assets';
import { settleArchivedAssetQueries } from './archive-query-cache';

export function useArchiveAsset(): UseMutationResult<
  ArchiveAssetResult,
  Error,
  { readableId: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archiveAsset,
    onSuccess: (...[result, { readableId }]) => {
      settleArchivedAssetQueries({ queryClient, readableId, result });
    },
  });
}
