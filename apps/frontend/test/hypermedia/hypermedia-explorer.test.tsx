import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HypermediaPageStatus } from '../../src/components/hypermedia/hypermedia-explorer';

afterEach(cleanup);

test('Map exposes the next page batch without hiding incomplete connections', async () => {
  const onLoadMore = mock(() => undefined);
  const user = userEvent.setup();
  render(
    <HypermediaPageStatus
      pageCount={32}
      loading={false}
      suppressed={false}
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

test('Interval navigation suppresses stale page status until the next query settles', () => {
  render(
    <HypermediaPageStatus
      pageCount={0}
      loading={false}
      suppressed={true}
      error={null}
      hasNextPage={false}
      referencesTruncated={false}
      onRetry={() => undefined}
      onLoadMore={() => undefined}
    />,
  );

  expect(screen.queryByRole('status')).toBeNull();
});
