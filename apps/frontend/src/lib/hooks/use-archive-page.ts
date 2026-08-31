import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { entitiesQueryKey } from '../../queries/entities';
import { type ArchivePageResult, archivePage, pagesQueryKey } from '../../queries/pages';

export function useArchivePage(): UseMutationResult<
  ArchivePageResult,
  Error,
  { readableId: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: archivePage,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pagesQueryKey }),
        queryClient.invalidateQueries({ queryKey: entitiesQueryKey }),
      ]);
    },
  });
}
