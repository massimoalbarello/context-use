import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiKeysQueryKey, createApiKey, revokeApiKey } from '../../queries/api-keys';

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createApiKey,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: apiKeysQueryKey }),
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeApiKey,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: apiKeysQueryKey }),
  });
}
