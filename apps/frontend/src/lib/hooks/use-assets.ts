import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  assetPreviewQueryOptions,
  assetQueryOptions,
  assetSuggestionsQueryOptions,
  assetsQueryOptions,
  imageAssetSuggestionsQueryOptions,
} from '../../queries/assets';

export function useAssets() {
  const query = useInfiniteQuery(assetsQueryOptions);
  return {
    ...query,
    assets: query.data?.pages.flatMap((page) => page.items) ?? [],
    total: query.data?.pages[0]?.total ?? 0,
  };
}

export function useAsset(readableId: string) {
  return useQuery(assetQueryOptions(readableId));
}

export function useAssetPreview(readableId: string) {
  return useQuery(assetPreviewQueryOptions(readableId));
}

export function useAssetSuggestions(query: string | null) {
  return useQuery({
    ...assetSuggestionsQueryOptions(query ?? ''),
    enabled: query !== null,
  });
}

export function useImageAssetSuggestions(query: string) {
  return useQuery(imageAssetSuggestionsQueryOptions(query));
}
