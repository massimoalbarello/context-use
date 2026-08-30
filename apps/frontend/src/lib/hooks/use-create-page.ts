import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { type CreatePageVariables, createPage, pagesQueryKey } from '../../queries/pages';

export function useCreatePage(): UseMutationResult<
  { readableId: string },
  Error,
  CreatePageVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPage,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pagesQueryKey });
    },
  });
}
