import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRecordSync, recordSyncsQueryKey, revokeRecordSync } from '../../queries/syncs';

export function useCreateRecordSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createRecordSync,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: recordSyncsQueryKey }),
  });
}

export function useRevokeRecordSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeRecordSync,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: recordSyncsQueryKey }),
  });
}
