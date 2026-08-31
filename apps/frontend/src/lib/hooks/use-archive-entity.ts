import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ArchiveEntityResult, archiveEntity, entitiesQueryKey } from '../../queries/entities';
import { pagesQueryKey } from '../../queries/pages';

export function useArchiveEntity(): UseMutationResult<
  ArchiveEntityResult,
  Error,
  { readableId: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: archiveEntity,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: entitiesQueryKey }),
        queryClient.invalidateQueries({ queryKey: pagesQueryKey }),
      ]);
    },
  });
}
