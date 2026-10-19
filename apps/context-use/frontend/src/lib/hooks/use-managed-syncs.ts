import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  configureOAuthApp,
  connectSyncProvider,
  managedSyncsQueryKey,
  reauthorizeSyncProvider,
  updateManagedSync,
} from '../../queries/managed-syncs';

export function useConfigureOAuthApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: configureOAuthApp,
    gcTime: 0,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: managedSyncsQueryKey });
    },
  });
}

export function useConnectSyncProvider() {
  return useProviderAuthorization(connectSyncProvider);
}
export function useReauthorizeSyncProvider() {
  return useProviderAuthorization(reauthorizeSyncProvider);
}
function useProviderAuthorization(mutationFn: typeof connectSyncProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    gcTime: 0,
    onSuccess: async (result) => {
      if (result.authorizationUrl) {
        window.location.assign(result.authorizationUrl);
      } else {
        await queryClient.invalidateQueries({ queryKey: managedSyncsQueryKey });
      }
    },
  });
}
export function useUpdateManagedSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateManagedSync,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: managedSyncsQueryKey });
    },
  });
}
