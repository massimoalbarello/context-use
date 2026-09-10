import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageFilters } from '../../src/components/pages/page-filters';

afterEach(cleanup);

function renderPageFilters() {
  const onQueryApply = mock(() => undefined);
  const onIntervalChange = mock(() => undefined);
  const onDateRangeApply = mock(() => undefined);
  render(
    <PageFilters
      query=""
      onQueryApply={onQueryApply}
      onIntervalChange={onIntervalChange}
      onDateRangeApply={onDateRangeApply}
    />,
  );
  return { onQueryApply, onIntervalChange, onDateRangeApply };
}

test('Pages keeps its search, interval, and date controls behind one filter icon', async () => {
  const user = userEvent.setup();
  const { onQueryApply, onIntervalChange } = renderPageFilters();
  const trigger = screen.getByRole('button', { name: 'Filter pages' });

  expect(trigger.textContent).toBe('');
  expect(screen.queryByRole('searchbox', { name: 'Keyword' })).toBeNull();

  await user.click(trigger);

  const keyword = screen.getByRole('searchbox', { name: 'Keyword' });
  const filterWindow = screen.getByRole('region', { name: 'Filter pages' });
  const filterText = filterWindow.textContent ?? '';
  expect(keyword.getAttribute('placeholder')).toBe('Page title');
  expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('button', { name: 'Choose dates' })).toBeTruthy();
  expect(filterText.indexOf('Interval')).toBeLessThan(filterText.indexOf('Keyword'));
  expect(filterText.indexOf('Keyword')).toBeLessThan(filterText.indexOf('Filter by date range'));

  await user.click(screen.getByRole('tab', { name: 'With' }));
  expect(onIntervalChange).toHaveBeenLastCalledWith('with');

  await user.type(keyword, ' launch ');
  await user.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onQueryApply).toHaveBeenLastCalledWith('launch');
});

test('Pages hides date filtering when pages without intervals are selected', async () => {
  const user = userEvent.setup();
  render(
    <PageFilters
      query=""
      interval="without"
      onQueryApply={() => undefined}
      onIntervalChange={() => undefined}
      onDateRangeApply={() => undefined}
    />,
  );

  await user.click(screen.getByRole('button', { name: 'Filter pages' }));

  expect(screen.getByRole('tab', { name: 'Without' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByText('Filter by date range')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Choose dates' })).toBeNull();
});

test('Command K opens the Pages filter window and focuses keyword search', async () => {
  const user = userEvent.setup();
  renderPageFilters();

  await user.keyboard('{Meta>}k{/Meta}');
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Keyword' }));
});
