import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export const publicSiteQueryKey = ['public-site'] as const;

export const publicSiteQueryOptions = queryOptions({
  queryKey: publicSiteQueryKey,
  queryFn: async () => {
    const { data, error } = await api.api['public-site'].get();
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});

export type PublicSiteSettings = NonNullable<
  Awaited<ReturnType<(typeof api.api)['public-site']['get']>>['data']
>;

export async function setHomepage(readableId: string | null) {
  const { error } = await api.api['public-site'].homepage.put({ readableId });
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}
