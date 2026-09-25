import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ArchivePageResult, archivePage } from '../../queries/pages';
import { publicationStatusQueryOptions } from '../../queries/publications';
import { settleArchivedPageQueries } from './archive-query-cache';

export function useArchivePage(): UseMutationResult<
  ArchivePageResult,
  Error,
  { readableId: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: archivePage,
    onSuccess: (...[result, { readableId }]) => {
      settleArchivedPageQueries({ queryClient, readableId, result });
    },
    onError: (...[_error, { readableId }]) =>
      queryClient.invalidateQueries(
        publicationStatusQueryOptions({ resourceType: 'page', readableId }),
      ),
  });
}
