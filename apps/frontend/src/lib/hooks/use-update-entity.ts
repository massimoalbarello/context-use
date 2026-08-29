import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { entitiesQueryKey } from '../../queries/entities';
import { api } from '../api';
import { apiErrorMessage } from '../api-error';

type UpdateEntityVariables = {
  readableId: string;
  body: Parameters<ReturnType<typeof api.api.entities>['patch']>[0];
};

export function useUpdateEntity(): UseMutationResult<void, Error, UpdateEntityVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ readableId, body }) => {
      const { error } = await api.api.entities({ entityReadableId: readableId }).patch(body);
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: entitiesQueryKey });
    },
  });
}
