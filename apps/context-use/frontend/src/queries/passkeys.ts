import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export const passkeyOriginsQueryOptions = queryOptions({
  queryKey: ['passkey-origins'],
  queryFn: async () => {
    const { data, error } = await api['.well-known'].webauthn.get();
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});
