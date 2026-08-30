import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export const ownerRegistrationQueryOptions = queryOptions({
  queryKey: ['owner-registration'],
  queryFn: async () => {
    const { data, error } = await api.api['owner-registration'].get();
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});
