import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ArchiveAssetResult, archiveAsset } from '../../queries/assets';
import { publicationStatusQueryOptions } from '../../queries/publications';
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
    onError: (...[_error, { readableId }]) =>
      queryClient.invalidateQueries(
        publicationStatusQueryOptions({ resourceType: 'asset', readableId }),
      ),
  });
}
