import type { QueryClient } from '@tanstack/react-query';
import {
  type ArchiveAssetResult,
  assetDetailsQueryKey,
  assetPreviewQueryOptions,
  assetPreviewsQueryKey,
  assetQueryOptions,
  assetSuggestionsQueryKey,
  assetsListQueryKey,
} from '../../queries/assets';
import {
  type ArchiveEntityResult,
  entitiesListQueryKey,
  entityDetailsQueryKey,
  entityPreviewQueryOptions,
  entityPreviewsQueryKey,
  entityQueryOptions,
  entitySuggestionsQueryKey,
} from '../../queries/entities';
import { hypermediaQueryKey } from '../../queries/hypermedia';
import {
  type ArchivePageResult,
  pageDetailsQueryKey,
  pagePreviewQueryOptions,
  pageQueryOptions,
  pageSuggestionsQueryKey,
  pagesListQueryKey,
} from '../../queries/pages';

export function settleArchivedAssetQueries({
  queryClient,
  readableId,
  result,
}: {
  queryClient: QueryClient;
  readableId: string;
  result: ArchiveAssetResult;
}) {
  const detailQueryKey = assetQueryOptions(readableId).queryKey;
  const previewQueryKey = assetPreviewQueryOptions(readableId).queryKey;

  if (result.state === 'resource_in_use') {
    void queryClient.invalidateQueries({ queryKey: detailQueryKey, exact: true });
    return;
  }

  queryClient.removeQueries({ queryKey: detailQueryKey, exact: true });
  queryClient.removeQueries({ queryKey: previewQueryKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: assetsListQueryKey });
  void queryClient.invalidateQueries({ queryKey: assetSuggestionsQueryKey });
  void queryClient.invalidateQueries({ queryKey: hypermediaQueryKey });
}

export function settleArchivedEntityQueries({
  queryClient,
  readableId,
  result,
}: {
  queryClient: QueryClient;
  readableId: string;
  result: ArchiveEntityResult;
}) {
  const detailQueryKey = entityQueryOptions(readableId).queryKey;
  const previewQueryKey = entityPreviewQueryOptions(readableId).queryKey;

  if (result.state === 'resource_in_use') {
    void queryClient.invalidateQueries({ queryKey: detailQueryKey, exact: true });
    return;
  }

  queryClient.removeQueries({ queryKey: detailQueryKey, exact: true });
  queryClient.removeQueries({ queryKey: previewQueryKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: entitiesListQueryKey });
  void queryClient.invalidateQueries({ queryKey: entitySuggestionsQueryKey });
  void queryClient.invalidateQueries({ queryKey: hypermediaQueryKey });
}

export function settleArchivedPageQueries({
  queryClient,
  readableId,
  result,
}: {
  queryClient: QueryClient;
  readableId: string;
  result: ArchivePageResult;
}) {
  const detailQueryKey = pageQueryOptions(readableId).queryKey;
  const previewQueryKey = pagePreviewQueryOptions(readableId).queryKey;

  if (result.state === 'resource_in_use') {
    void queryClient.invalidateQueries({ queryKey: detailQueryKey, exact: true });
    return;
  }

  queryClient.removeQueries({ queryKey: detailQueryKey, exact: true });
  queryClient.removeQueries({ queryKey: previewQueryKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: pagesListQueryKey });
  void queryClient.invalidateQueries({ queryKey: pageSuggestionsQueryKey });
  void queryClient.invalidateQueries({ queryKey: hypermediaQueryKey });
  void queryClient.invalidateQueries({
    queryKey: pageDetailsQueryKey,
    predicate: (query) => query.queryKey[2] !== readableId,
  });
  void queryClient.invalidateQueries({ queryKey: entityDetailsQueryKey });
  void queryClient.invalidateQueries({ queryKey: entityPreviewsQueryKey });
  void queryClient.invalidateQueries({ queryKey: assetDetailsQueryKey });
  void queryClient.invalidateQueries({ queryKey: assetPreviewsQueryKey });
}
