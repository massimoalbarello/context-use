import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ApiStatus, apiErrorMessage } from '../lib/api-error';

export type KnowledgeProfile = NonNullable<Awaited<ReturnType<typeof api.api.profile.get>>['data']>;

export const profileQueryKey = ['profile'] as const;

export const profileQueryOptions = queryOptions({
  queryKey: profileQueryKey,
  queryFn: async () => {
    const { data, error } = await api.api.profile.get();
    if (error) {
      if (error.status === ApiStatus.NotFound) {
        return null;
      }
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});
