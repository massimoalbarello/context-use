import { afterEach, expect, test } from 'bun:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HypermediaTimeRange } from '../../src/components/hypermedia/hypermedia-time-range';
import {
  calendarDateFromEpochDay,
  calendarDateRangeFromSearch,
  epochDayFromCalendarDate,
} from '../../src/lib/temporal-coverage';
import { type HypermediaSearch, hypermediaSearchWithDateRange } from '../../src/routes/hypermedia';

afterEach(cleanup);

const TEMPORAL_EXTENT = {
  start: Date.parse('2024-01-01T00:00:00.000Z'),
  end: Date.parse('2026-12-31T00:00:00.000Z'),
};

test('calendar dates round-trip through UTC epoch days', () => {
  expect(calendarDateFromEpochDay(epochDayFromCalendarDate('2026-03-29'))).toBe('2026-03-29');
});

test('shows distinct messages for page and connection overflow', () => {
  const { rerender } = render(
    <HypermediaTimeRange
      extent={null}
      hasMorePages
      referencesTruncated={false}
      loading={false}
      error={null}
      onApply={() => undefined}
      onRetry={() => undefined}
    />,
  );

  expect(
    screen.getByText('More pages match this view. Select entities or narrow the time range.'),
  ).toBeTruthy();

  rerender(
    <HypermediaTimeRange
      extent={null}
      hasMorePages={false}
      referencesTruncated
      loading={false}
      error={null}
      onApply={() => undefined}
      onRetry={() => undefined}
    />,
  );

  expect(
    screen.getByText('Some page connections are hidden. Select entities or narrow the time range.'),
  ).toBeTruthy();

  rerender(
    <HypermediaTimeRange
      extent={null}
      hasMorePages
      referencesTruncated
      loading={false}
      error={null}
      onApply={() => undefined}
      onRetry={() => undefined}
    />,
  );

  expect(
    screen.getByText(
      'More pages match this view, and some page connections are hidden. Select entities or narrow the time range.',
    ),
  ).toBeTruthy();
});

test('commits and resets the accessible time range through URL search state', async () => {
  const rootRoute = createRootRoute({ component: Outlet });
  const rangeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    validateSearch: (search): HypermediaSearch => calendarDateRangeFromSearch(search) ?? {},
    component: () => {
      const search = rangeRoute.useSearch();
      const navigate = rangeRoute.useNavigate();
      return (
        <HypermediaTimeRange
          value={calendarDateRangeFromSearch(search)}
          extent={TEMPORAL_EXTENT}
          hasMorePages={false}
          referencesTruncated={false}
          loading={false}
          error={null}
          onApply={(nextRange) => {
            void navigate({
              search: (previous) => hypermediaSearchWithDateRange({ previous, nextRange }),
              replace: true,
            });
          }}
          onRetry={() => undefined}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([rangeRoute]),
    history: createMemoryHistory({ initialEntries: ['/?from=2025-03-01&to=2026-03-31'] }),
  });
  await router.load();
  const user = userEvent.setup();

  render(<RouterProvider router={router} />);
  expect(screen.queryByRole('slider', { name: 'Start date' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /1 Mar 2025 – 31 Mar 2026/ }));

  const startThumb = screen.getByRole('slider', { name: 'Start date' });
  expect(screen.getByRole('slider', { name: 'End date' })).toBeTruthy();
  startThumb.focus();
  await user.keyboard('{ArrowRight}');

  await waitFor(() => {
    expect(router.state.location.search).toMatchObject({
      from: '2025-03-02',
      to: '2026-03-31',
    });
  });

  await user.click(screen.getByRole('button', { name: 'All time' }));
  await waitFor(() => {
    expect(router.state.location.search).toEqual({});
  });
});
