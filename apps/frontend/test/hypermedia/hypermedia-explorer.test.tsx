import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HypermediaPageStatus } from '../../src/components/hypermedia/hypermedia-explorer';

afterEach(cleanup);

test('semantic Hypermedia exposes the next page batch without hiding incomplete connections', async () => {
  const onLoadMore = mock(() => undefined);
  const user = userEvent.setup();
  render(
    <HypermediaPageStatus
      pageType="semantic"
      pageCount={32}
      loading={false}
      error={null}
      hasNextPage={true}
      referencesTruncated={true}
      onRetry={() => undefined}
      onLoadMore={onLoadMore}
    />,
  );

  expect(
    screen.getByText('More pages are available, and some page connections are hidden.'),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Load more pages' }));
  expect(onLoadMore).toHaveBeenCalledTimes(1);
});

test('temporal Hypermedia reports incomplete page connections without a manual paging action', () => {
  render(
    <HypermediaPageStatus
      pageType="temporal"
      pageCount={32}
      loading={false}
      error={null}
      hasNextPage={true}
      referencesTruncated={true}
      onRetry={() => undefined}
      onLoadMore={() => undefined}
    />,
  );

  expect(screen.getByText('Some page connections are hidden.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Load more pages' })).toBeNull();
});

test('all-page Hypermedia status does not describe mixed results as semantic', () => {
  render(
    <HypermediaPageStatus
      pageType="all"
      pageCount={0}
      loading={false}
      error={null}
      hasNextPage={false}
      referencesTruncated={false}
      onRetry={() => undefined}
      onLoadMore={() => undefined}
    />,
  );

  expect(screen.getByText('No pages match this view.')).toBeTruthy();
});
