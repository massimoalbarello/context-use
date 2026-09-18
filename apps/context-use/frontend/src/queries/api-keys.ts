import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

const apiKeys = api.api['api-keys'];

export type ApiKeyList = NonNullable<Awaited<ReturnType<typeof apiKeys.get>>['data']>;
export type ApiKey = ApiKeyList['items'][number];
export type CreatedApiKey = NonNullable<Awaited<ReturnType<typeof apiKeys.post>>['data']>;

export const apiKeysQueryKey = ['api-keys'] as const;

export const apiKeysQueryOptions = queryOptions({
  queryKey: apiKeysQueryKey,
  queryFn: async () => {
    const { data, error } = await apiKeys.get();
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});

export async function createApiKey(input: { name: string }) {
  const { data, error } = await apiKeys.post(input);
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
  return data;
}

export async function revokeApiKey(input: { keyReadableId: string }): Promise<void> {
  const { error } = await apiKeys({ keyReadableId: input.keyReadableId }).revoke.put();
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}
