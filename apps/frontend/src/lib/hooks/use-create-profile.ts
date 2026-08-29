import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileQueryKey } from '../../queries/profile';
import { api } from '../api';
import {
  ApiStatus,
  apiErrorMessage,
  ReadableIdConflictError,
  ReadableIdRequiredError,
} from '../api-error';

type CreateProfileVariables = Parameters<typeof api.api.profile.post>[0];
type CreatedProfile = NonNullable<Awaited<ReturnType<typeof api.api.profile.post>>['data']>;

export function useCreateProfile(): UseMutationResult<
  CreatedProfile,
  Error,
  CreateProfileVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body) => {
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
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(profileQueryKey, profile);
    },
  });
}
