import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ApiStatus, apiErrorMessage, DuplicateResourceNameError } from '../lib/api-error';

export type AssetPage = NonNullable<Awaited<ReturnType<typeof api.api.assets.get>>['data']>;
export type AssetSummary = AssetPage['items'][number];
export type Asset = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.assets>['get']>>['data']
>;

export type CreateAssetVariables = Parameters<typeof api.api.assets.post>[0];
export type UpdateAssetVariables = {
  readableId: string;
  body: Parameters<ReturnType<typeof api.api.assets>['put']>[0];
};
export type ArchiveAssetResult =
  | { state: 'archived' }
  | { state: 'resource_in_use'; blockers: Asset['usages'] };

export const assetsQueryKey = ['assets'] as const;
export const assetsListQueryKey = [...assetsQueryKey, 'list'] as const;
export const assetDetailsQueryKey = [...assetsQueryKey, 'detail'] as const;
export const assetSuggestionsQueryKey = [...assetsQueryKey, 'suggestions'] as const;

export const assetsQueryOptions = infiniteQueryOptions({
  queryKey: assetsListQueryKey,
  initialPageParam: 0,
  queryFn: async ({ pageParam }) => {
    const { data, error } = await api.api.assets.get({ query: { offset: pageParam } });
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
  getNextPageParam: (page) => page.nextOffset ?? undefined,
});

export function assetSuggestionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: [...assetSuggestionsQueryKey, query],
    queryFn: async () => {
      const { data, error } = await api.api.assets.get({
        query: { limit: 7, offset: 0, query },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data.items;
    },
  });
}

export function imageAssetSuggestionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: [...assetSuggestionsQueryKey, 'image', query],
    queryFn: async () => {
      const { data, error } = await api.api.assets.get({
        query: { limit: 7, offset: 0, query, kind: 'entity_image' },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data.items;
    },
  });
}

export function assetQueryOptions(readableId: string) {
  return queryOptions({
    queryKey: [...assetDetailsQueryKey, readableId],
    queryFn: async () => {
      const { data, error } = await api.api.assets({ assetReadableId: readableId }).get();
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}

export async function createAsset(body: CreateAssetVariables): Promise<{ readableId: string }> {
  const { data, error } = await api.api.assets.post({
    name: body.name,
    file: body.file,
    ...(body.allowDuplicate === undefined ? {} : { allowDuplicate: body.allowDuplicate }),
  });
  if (error) {
    if (error.status === ApiStatus.Conflict && 'nameConflict' in error.value) {
      throw new DuplicateResourceNameError(apiErrorMessage(error));
    }
    throw new Error(apiErrorMessage(error));
  }
  return { readableId: data.readableId };
}

export async function updateAsset({ readableId, body }: UpdateAssetVariables): Promise<void> {
  const { error } = await api.api.assets({ assetReadableId: readableId }).put(body);
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}

export async function archiveAsset({
  readableId,
}: {
  readableId: string;
}): Promise<ArchiveAssetResult> {
  const { error } = await api.api.assets({ assetReadableId: readableId }).archive.put();
  if (error) {
    if (error.status === ApiStatus.Conflict && 'blockers' in error.value) {
      return { state: 'resource_in_use', blockers: error.value.blockers };
    }
    throw new Error(apiErrorMessage(error));
  }
  return { state: 'archived' };
}
