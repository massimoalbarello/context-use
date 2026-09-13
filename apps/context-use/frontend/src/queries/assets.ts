import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ApiStatus, apiErrorMessage, DuplicateResourceNameError } from '../lib/api-error';
import { searchHypermedia } from './hypermedia-search';

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
export const assetPreviewsQueryKey = [...assetsQueryKey, 'preview'] as const;
export const assetSuggestionsQueryKey = [...assetsQueryKey, 'suggestions'] as const;
const PREVIEW_RELATIONSHIP_LIMIT = 12;
const SUGGESTION_LIMIT = 7;

async function assetSearchPage({
  query,
  limit,
  assetKind,
}: {
  query: string;
  limit?: number;
  assetKind?: 'entity_image';
}): Promise<AssetPage> {
  const result = await searchHypermedia({ query, resourceTypes: 'asset', limit, assetKind });
  return {
    items: result.results.flatMap((hit) => (hit.resourceType === 'asset' ? [hit.asset] : [])),
    total: result.totalMatches,
    nextOffset: null,
  };
}

export function assetsQueryOptions(query?: string) {
  const normalizedQuery = query?.trim() || undefined;
  return infiniteQueryOptions({
    queryKey: [...assetsListQueryKey, { query: normalizedQuery ?? null }],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (normalizedQuery) {
        return assetSearchPage({ query: normalizedQuery });
      }
      const { data, error } = await api.api.assets.get({
        query: { offset: pageParam },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
}

export function imageAssetSuggestionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: [...assetSuggestionsQueryKey, 'image', query],
    queryFn: async () => {
      if (query.trim()) {
        return (
          await assetSearchPage({ query, limit: SUGGESTION_LIMIT, assetKind: 'entity_image' })
        ).items;
      }
      const { data, error } = await api.api.assets.get({
        query: { limit: SUGGESTION_LIMIT, offset: 0, kind: 'entity_image' },
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

export function assetPreviewQueryOptions(readableId: string) {
  return queryOptions({
    queryKey: [...assetPreviewsQueryKey, readableId],
    queryFn: async () => {
      const { data, error } = await api.api
        .assets({ assetReadableId: readableId })
        .get({ query: { relationshipLimit: PREVIEW_RELATIONSHIP_LIMIT } });
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
