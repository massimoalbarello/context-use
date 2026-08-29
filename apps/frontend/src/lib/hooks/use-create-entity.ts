import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { entitiesQueryKey } from '../../queries/entities';
import { api } from '../api';
import { apiErrorMessage } from '../api-error';

type CreateEntityVariables = Parameters<typeof api.api.entities.post>[0];

export function useCreateEntity(): UseMutationResult<void, Error, CreateEntityVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body) => {
      const { error } = await api.api.entities.post(body);
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: entitiesQueryKey });
    },
  });
}
