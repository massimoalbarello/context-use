import type { QueryClient } from '@tanstack/react-query';
import {
  type ArchiveEntityResult,
  entitiesListQueryKey,
  entityDetailsQueryKey,
  entityQueryOptions,
  entitySuggestionsQueryKey,
} from '../../queries/entities';
import {
  type ArchivePageResult,
  pageDetailsQueryKey,
  pageQueryOptions,
  pageSuggestionsQueryKey,
  pagesListQueryKey,
} from '../../queries/pages';

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

  if (result.state === 'resource_in_use') {
    void queryClient.invalidateQueries({ queryKey: detailQueryKey, exact: true });
    return;
  }

  queryClient.removeQueries({ queryKey: detailQueryKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: entitiesListQueryKey });
  void queryClient.invalidateQueries({ queryKey: entitySuggestionsQueryKey });
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

  if (result.state === 'resource_in_use') {
    void queryClient.invalidateQueries({ queryKey: detailQueryKey, exact: true });
    return;
  }

  queryClient.removeQueries({ queryKey: detailQueryKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: pagesListQueryKey });
  void queryClient.invalidateQueries({ queryKey: pageSuggestionsQueryKey });
  void queryClient.invalidateQueries({
    queryKey: pageDetailsQueryKey,
    predicate: (query) => query.queryKey[2] !== readableId,
  });
  void queryClient.invalidateQueries({ queryKey: entityDetailsQueryKey });
}
