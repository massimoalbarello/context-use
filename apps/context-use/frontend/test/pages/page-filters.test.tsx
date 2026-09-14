import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageFilters } from '../../src/components/pages/page-filters';

afterEach(cleanup);

function renderPageFilters() {
  const onIntervalChange = mock(() => undefined);
  const onDateRangeApply = mock(() => undefined);
  render(<PageFilters onIntervalChange={onIntervalChange} onDateRangeApply={onDateRangeApply} />);
  return { onIntervalChange, onDateRangeApply };
}

test('Pages keeps only interval and date controls behind the filter icon', async () => {
  const user = userEvent.setup();
  const { onIntervalChange } = renderPageFilters();
  const trigger = screen.getByRole('button', { name: 'Filter pages' });

  expect(trigger.textContent).toBe('');
  expect(screen.queryByRole('searchbox', { name: 'Keyword' })).toBeNull();

  await user.click(trigger);

  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('button', { name: 'Filter by date range: Choose dates' })).toBeTruthy();

  await user.click(screen.getByRole('tab', { name: 'With' }));
  expect(onIntervalChange).toHaveBeenLastCalledWith('with');
});

test('Pages hides date filtering when pages without intervals are selected', async () => {
  const user = userEvent.setup();
  render(
    <PageFilters
      interval="without"
      onIntervalChange={() => undefined}
      onDateRangeApply={() => undefined}
    />,
  );

  await user.click(screen.getByRole('button', { name: 'Filter pages' }));

  expect(screen.getByRole('tab', { name: 'Without' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByText('Filter by date range')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Choose dates' })).toBeNull();
});
