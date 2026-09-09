import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type RecordSyncList = NonNullable<Awaited<ReturnType<typeof api.api.syncs.get>>['data']>;
export type RecordSync = RecordSyncList['items'][number];
export type CreatedRecordSync = NonNullable<Awaited<ReturnType<typeof api.api.syncs.post>>['data']>;

export const recordSyncsQueryKey = ['record-syncs'] as const;

export const recordSyncsQueryOptions = queryOptions({
  queryKey: recordSyncsQueryKey,
  queryFn: async () => {
    const { data, error } = await api.api.syncs.get();
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});

export async function createRecordSync(input: { name: string }) {
  const { data, error } = await api.api.syncs.post(input);
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
  return data;
}

export async function revokeRecordSync(input: { syncReadableId: string }): Promise<void> {
  const { error } = await api.api.syncs({ syncReadableId: input.syncReadableId }).revoke.put();
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}
