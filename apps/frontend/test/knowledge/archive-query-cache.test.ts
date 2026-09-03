import { expect, test } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  settleArchivedAssetQueries,
  settleArchivedEntityQueries,
  settleArchivedPageQueries,
} from '../../src/lib/hooks/archive-query-cache';
import {
  assetDetailsQueryKey,
  assetPreviewQueryOptions,
  assetQueryOptions,
  assetSuggestionsQueryKey,
  assetsListQueryKey,
} from '../../src/queries/assets';
import {
  entitiesListQueryKey,
  entityDetailsQueryKey,
  entityPreviewQueryOptions,
  entityQueryOptions,
  entitySuggestionsQueryKey,
} from '../../src/queries/entities';
import { hypermediaQueryKey } from '../../src/queries/hypermedia';
import {
  pageDetailsQueryKey,
  pagePreviewQueryOptions,
  pageQueryOptions,
  pageSuggestionsQueryKey,
  pagesListQueryKey,
} from '../../src/queries/pages';

test('page archive removes its unavailable detail without refetching it', async () => {
  const queryClient = new QueryClient();
  const archivedDetailQueryKey = pageQueryOptions('weekly-review').queryKey;
  const archivedPreviewQueryKey = pagePreviewQueryOptions('weekly-review').queryKey;
  const entityPreviewQueryKey = entityPreviewQueryOptions('alex-morgan').queryKey;
  const assetPreviewQueryKey = assetPreviewQueryOptions('quarterly-chart').queryKey;
  let archivedDetailRequests = 0;
  queryClient.setQueryData<unknown>(archivedDetailQueryKey, { readableId: 'weekly-review' });
  queryClient.setQueryData<unknown>(archivedPreviewQueryKey, { readableId: 'weekly-review' });
  queryClient.setQueryData(pagesListQueryKey, { items: [] });
  queryClient.setQueryData([...pageSuggestionsQueryKey, 'week'], []);
  queryClient.setQueryData([...pageDetailsQueryKey, 'project-brief'], {
    readableId: 'project-brief',
  });
  queryClient.setQueryData([...entityDetailsQueryKey, 'alex-morgan'], {
    readableId: 'alex-morgan',
  });
  queryClient.setQueryData([...assetDetailsQueryKey, 'quarterly-chart'], {
    readableId: 'quarterly-chart',
  });
  queryClient.setQueryData<unknown>(entityPreviewQueryKey, { readableId: 'alex-morgan' });
  queryClient.setQueryData<unknown>(assetPreviewQueryKey, { readableId: 'quarterly-chart' });
  queryClient.setQueryData(hypermediaQueryKey, { pages: [] });

  const archivedDetailObserver = new QueryObserver(queryClient, {
    queryKey: archivedDetailQueryKey,
    queryFn: () => {
      archivedDetailRequests += 1;
      return { readableId: 'weekly-review' };
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const unsubscribe = archivedDetailObserver.subscribe(() => undefined);

  settleArchivedPageQueries({
    queryClient,
    readableId: 'weekly-review',
    result: { state: 'archived' },
  });
  await Promise.resolve();

  expect(archivedDetailRequests).toBe(0);
  expect(queryClient.getQueryData(archivedDetailQueryKey)).toBeUndefined();
  expect(queryClient.getQueryData(archivedPreviewQueryKey)).toBeUndefined();
  expect(queryClient.getQueryState(pagesListQueryKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState([...pageSuggestionsQueryKey, 'week'])?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState([...pageDetailsQueryKey, 'project-brief'])?.isInvalidated).toBe(
    true,
  );
  expect(queryClient.getQueryState([...entityDetailsQueryKey, 'alex-morgan'])?.isInvalidated).toBe(
    true,
  );
  expect(
    queryClient.getQueryState([...assetDetailsQueryKey, 'quarterly-chart'])?.isInvalidated,
  ).toBe(true);
  expect(queryClient.getQueryState(entityPreviewQueryKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(assetPreviewQueryKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(hypermediaQueryKey)?.isInvalidated).toBe(true);

  unsubscribe();
});

test('asset archive removes its unavailable detail and refreshes asset discovery', () => {
  const queryClient = new QueryClient();
  const archivedDetailQueryKey = assetQueryOptions('quarterly-chart').queryKey;
  const archivedPreviewQueryKey = assetPreviewQueryOptions('quarterly-chart').queryKey;
  queryClient.setQueryData<unknown>(archivedDetailQueryKey, {
    readableId: 'quarterly-chart',
  });
  queryClient.setQueryData<unknown>(archivedPreviewQueryKey, {
    readableId: 'quarterly-chart',
  });
  queryClient.setQueryData(assetsListQueryKey, { items: [] });
  queryClient.setQueryData([...assetSuggestionsQueryKey, 'quarter'], []);
  queryClient.setQueryData(hypermediaQueryKey, { pages: [] });

  settleArchivedAssetQueries({
    queryClient,
    readableId: 'quarterly-chart',
    result: { state: 'archived' },
  });

  expect(queryClient.getQueryData(archivedDetailQueryKey)).toBeUndefined();
  expect(queryClient.getQueryData(archivedPreviewQueryKey)).toBeUndefined();
  expect(queryClient.getQueryState(assetsListQueryKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState([...assetSuggestionsQueryKey, 'quarter'])?.isInvalidated).toBe(
    true,
  );
  expect(queryClient.getQueryState(hypermediaQueryKey)?.isInvalidated).toBe(true);
});

test('entity archive refreshes only its active collections and pickers', () => {
  const queryClient = new QueryClient();
  const archivedDetailQueryKey = entityQueryOptions('maya-chen').queryKey;
  const archivedPreviewQueryKey = entityPreviewQueryOptions('maya-chen').queryKey;
  queryClient.setQueryData<unknown>(archivedDetailQueryKey, { readableId: 'maya-chen' });
  queryClient.setQueryData<unknown>(archivedPreviewQueryKey, { readableId: 'maya-chen' });
  queryClient.setQueryData(entitiesListQueryKey, { items: [] });
  queryClient.setQueryData([...entitySuggestionsQueryKey, 'maya'], []);
  queryClient.setQueryData([...pageDetailsQueryKey, 'project-brief'], {
    readableId: 'project-brief',
  });
  queryClient.setQueryData(hypermediaQueryKey, { pages: [] });

  settleArchivedEntityQueries({
    queryClient,
    readableId: 'maya-chen',
    result: { state: 'archived' },
  });

  expect(queryClient.getQueryData(archivedDetailQueryKey)).toBeUndefined();
  expect(queryClient.getQueryData(archivedPreviewQueryKey)).toBeUndefined();
  expect(queryClient.getQueryState(entitiesListQueryKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState([...entitySuggestionsQueryKey, 'maya'])?.isInvalidated).toBe(
    true,
  );
  expect(queryClient.getQueryState([...pageDetailsQueryKey, 'project-brief'])?.isInvalidated).toBe(
    false,
  );
  expect(queryClient.getQueryState(hypermediaQueryKey)?.isInvalidated).toBe(true);
});

test('archive conflict keeps and refreshes the still-available detail', () => {
  const queryClient = new QueryClient();
  const detailQueryKey = pageQueryOptions('weekly-review').queryKey;
  queryClient.setQueryData<unknown>(detailQueryKey, { readableId: 'weekly-review' });

  settleArchivedPageQueries({
    queryClient,
    readableId: 'weekly-review',
    result: { state: 'resource_in_use', blockers: [] },
  });

  expect(queryClient.getQueryData(detailQueryKey)).toBeDefined();
  expect(queryClient.getQueryState(detailQueryKey)?.isInvalidated).toBe(true);
});
