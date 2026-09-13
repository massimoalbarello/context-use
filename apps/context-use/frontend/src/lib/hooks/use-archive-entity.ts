import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ArchiveEntityResult, archiveEntity } from '../../queries/entities';
import { settleArchivedEntityQueries } from './archive-query-cache';

export function useArchiveEntity(): UseMutationResult<
  ArchiveEntityResult,
  Error,
  { readableId: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: archiveEntity,
    onSuccess: (...[result, { readableId }]) => {
      settleArchivedEntityQueries({ queryClient, readableId, result });
    },
  });
}
