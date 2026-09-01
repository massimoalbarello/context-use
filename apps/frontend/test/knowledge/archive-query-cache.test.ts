import { expect, test } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  settleArchivedAssetQueries,
  settleArchivedEntityQueries,
  settleArchivedPageQueries,
} from '../../src/lib/hooks/archive-query-cache';
import {
  assetDetailsQueryKey,
  assetQueryOptions,
  assetSuggestionsQueryKey,
  assetsListQueryKey,
} from '../../src/queries/assets';
import {
  entitiesListQueryKey,
  entityDetailsQueryKey,
  entityQueryOptions,
  entitySuggestionsQueryKey,
} from '../../src/queries/entities';
import {
  pageDetailsQueryKey,
  pageQueryOptions,
  pageSuggestionsQueryKey,
  pagesListQueryKey,
} from '../../src/queries/pages';

test('page archive removes its unavailable detail without refetching it', async () => {
  const queryClient = new QueryClient();
  const archivedDetailQueryKey = pageQueryOptions('weekly-review').queryKey;
  let archivedDetailRequests = 0;
  queryClient.setQueryData<unknown>(archivedDetailQueryKey, { readableId: 'weekly-review' });
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

  unsubscribe();
});

test('asset archive removes its unavailable detail and refreshes asset discovery', () => {
  const queryClient = new QueryClient();
  const archivedDetailQueryKey = assetQueryOptions('quarterly-chart').queryKey;
  queryClient.setQueryData<unknown>(archivedDetailQueryKey, {
    readableId: 'quarterly-chart',
  });
  queryClient.setQueryData(assetsListQueryKey, { items: [] });
  queryClient.setQueryData([...assetSuggestionsQueryKey, 'quarter'], []);

  settleArchivedAssetQueries({
    queryClient,
    readableId: 'quarterly-chart',
    result: { state: 'archived' },
  });

  expect(queryClient.getQueryData(archivedDetailQueryKey)).toBeUndefined();
  expect(queryClient.getQueryState(assetsListQueryKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState([...assetSuggestionsQueryKey, 'quarter'])?.isInvalidated).toBe(
    true,
  );
});

test('entity archive refreshes only its active collections and pickers', () => {
  const queryClient = new QueryClient();
  const archivedDetailQueryKey = entityQueryOptions('maya-chen').queryKey;
  queryClient.setQueryData<unknown>(archivedDetailQueryKey, { readableId: 'maya-chen' });
  queryClient.setQueryData(entitiesListQueryKey, { items: [] });
  queryClient.setQueryData([...entitySuggestionsQueryKey, 'maya'], []);
  queryClient.setQueryData([...pageDetailsQueryKey, 'project-brief'], {
    readableId: 'project-brief',
  });

  settleArchivedEntityQueries({
    queryClient,
    readableId: 'maya-chen',
    result: { state: 'archived' },
  });

  expect(queryClient.getQueryData(archivedDetailQueryKey)).toBeUndefined();
  expect(queryClient.getQueryState(entitiesListQueryKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState([...entitySuggestionsQueryKey, 'maya'])?.isInvalidated).toBe(
    true,
  );
  expect(queryClient.getQueryState([...pageDetailsQueryKey, 'project-brief'])?.isInvalidated).toBe(
    false,
  );
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
