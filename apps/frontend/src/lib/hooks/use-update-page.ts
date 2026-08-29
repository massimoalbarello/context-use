import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { pagesQueryKey } from '../../queries/pages';
import { api } from '../api';
import { apiErrorMessage } from '../api-error';

type UpdatePageVariables = {
  readableId: string;
  body: Parameters<ReturnType<typeof api.api.pages>['put']>[0];
};

export function useUpdatePage(): UseMutationResult<void, Error, UpdatePageVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ readableId, body }) => {
      const { error } = await api.api.pages({ pageReadableId: readableId }).put(body);
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pagesQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['entities'] }),
      ]);
    },
  });
}
