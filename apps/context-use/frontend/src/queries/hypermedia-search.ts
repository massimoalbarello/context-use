import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type HypermediaSearchInput = NonNullable<
  NonNullable<Parameters<typeof api.api.hypermedia.search.get>[0]>['query']
>;

/** Every lexical UI search uses the same application pipeline as MCP. */
export async function searchHypermedia({
  signal,
  ...query
}: HypermediaSearchInput & { signal?: AbortSignal }) {
  const { data, error } = await api.api.hypermedia.search.get({ query, fetch: { signal } });
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
  return data;
}
