import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type SyncProvider = NonNullable<
  Awaited<ReturnType<typeof api.api.syncs.managed.get>>['data']
>[number];
export type ManagedSync = SyncProvider['syncs'][number];
export const managedSyncsQueryKey = ['managed-syncs'] as const;
const REFRESH_MS = 5000;
export const managedSyncsQueryOptions = queryOptions({
  queryKey: managedSyncsQueryKey,
  queryFn: async () => {
    const { data, error } = await api.api.syncs.managed.get();
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
  refetchInterval: REFRESH_MS,
});
export type OAuthAppCredentials = Parameters<
  ReturnType<typeof api.api.syncs.managed.providers>['app']['post']
>[0];
export async function configureOAuthApp(input: {
  providerId: string;
  credentials: OAuthAppCredentials;
}) {
  const { error } = await api.api.syncs.managed
    .providers({ providerId: input.providerId })
    .app.post(input.credentials);
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}
export async function connectSyncProvider(providerId: string) {
  const { data, error } = await api.api.syncs.managed.providers({ providerId }).connect.post();
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
  return data;
}
export async function updateManagedSync(input: {
  key: string;
  action: 'pause' | 'resume' | 'run';
}) {
  const { error } = await api.api.syncs.managed({ key: input.key }).post({ action: input.action });
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}
