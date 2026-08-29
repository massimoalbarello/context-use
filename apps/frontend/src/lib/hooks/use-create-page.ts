import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { pagesQueryKey } from '../../queries/pages';
import { api } from '../api';
import { apiErrorMessage } from '../api-error';

type CreatePageVariables = Parameters<typeof api.api.pages.post>[0];

export function useCreatePage(): UseMutationResult<
  { readableId: string },
  Error,
  CreatePageVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body) => {
      const { data, error } = await api.api.pages.post(body);
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return { readableId: data.readableId };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pagesQueryKey });
    },
  });
}
