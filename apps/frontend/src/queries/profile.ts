import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  ApiStatus,
  apiErrorMessage,
  ReadableIdConflictError,
  ReadableIdRequiredError,
} from '../lib/api-error';

export type KnowledgeProfile = NonNullable<Awaited<ReturnType<typeof api.api.profile.get>>['data']>;
export type CreateProfileVariables = Parameters<typeof api.api.profile.post>[0];

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

export async function createProfile(body: CreateProfileVariables): Promise<KnowledgeProfile> {
  const { data, error } = await api.api.profile.post(body);
  if (error) {
    if (error.status === ApiStatus.BadRequest && 'readableIdRequired' in error.value) {
      throw new ReadableIdRequiredError(apiErrorMessage(error));
    }
    if (error.status === ApiStatus.Conflict && 'readableId' in error.value) {
      throw new ReadableIdConflictError({
        message: apiErrorMessage(error),
        readableId: error.value.readableId,
      });
    }
    throw new Error(apiErrorMessage(error));
  }
  return data;
}
