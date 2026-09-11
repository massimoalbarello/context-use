import { afterEach, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { RecordFilters } from '../../src/components/records/record-filters';
import { type RecordSearch, recordListFilters, recordSearch } from '../../src/lib/record-filters';
import { recordsQueryOptions } from '../../src/queries/records';

afterEach(cleanup);

test('record URL state validates ranges and gives each server filter a distinct paginated cache', () => {
  const search = recordSearch({
    provider: ' github ',
    kind: ' pull-request ',
    createdFrom: '2026-02-28',
    createdTo: '2026-03-01',
    updatedFrom: '2026-01-01',
    updatedTo: '2026-01-02',
    sortBy: 'sourceCreatedAt',
    sortDirection: 'asc',
  });
  const filters = recordListFilters(search);
  expect(filters).toEqual({
    provider: 'github',
    kind: 'pull-request',
    createdFrom: '2026-02-28T00:00:00.000Z',
    createdTo: '2026-03-02T00:00:00.000Z',
    updatedFrom: '2026-01-01T00:00:00.000Z',
    updatedTo: '2026-01-03T00:00:00.000Z',
    sortBy: 'sourceCreatedAt',
    sortDirection: 'asc',
  });
  expect(
    recordSearch({
      provider: 3,
      kind: '  ',
      sortBy: 'body',
      sortDirection: 'sideways',
      createdFrom: '2026-02-30',
      createdTo: '2026-03-01',
      updatedFrom: '2026-01-02',
      updatedTo: '2026-01-01',
    }),
  ).toEqual({});
  for (const field of Object.keys(filters) as (keyof typeof filters)[]) {
    expect(recordsQueryOptions(filters).queryKey).not.toEqual(
      recordsQueryOptions({ ...filters, [field]: undefined }).queryKey,
    );
  }
});

test('record controls select metadata, sort direction, and reset the current view', async () => {
  const user = userEvent.setup();
  function Controls() {
    const [search, setSearch] = useState<RecordSearch>({});
    return (
      <>
        <RecordFilters
          search={search}
          options={{ providers: ['github', 'slack'], kinds: ['pull-request', 'message'] }}
          onChange={setSearch}
        />
        <output aria-label="Selected filters">{JSON.stringify(search)}</output>
      </>
    );
  }
  render(<Controls />);
  await user.click(screen.getByRole('button', { name: 'Filter and sort records' }));
  expect(screen.getByRole('combobox', { name: 'Order by' }).textContent).toContain(
    'Source updated',
  );
  expect(screen.getByRole('combobox', { name: 'Direction' }).textContent).toContain('Newest first');
  await user.click(screen.getByRole('combobox', { name: 'Provider' }));
  await user.click(await screen.findByRole('option', { name: 'slack' }));
  await user.click(screen.getByRole('combobox', { name: 'Data kind' }));
  await user.click(await screen.findByRole('option', { name: 'message' }));
  await user.click(screen.getByRole('combobox', { name: 'Order by' }));
  await user.click(await screen.findByRole('option', { name: 'Provider' }));
  await user.click(screen.getByRole('combobox', { name: 'Direction' }));
  await user.click(await screen.findByRole('option', { name: 'A to Z' }));
  expect(screen.getByRole('combobox', { name: 'Order by' }).textContent).toContain('Provider');
  expect(screen.getByRole('combobox', { name: 'Direction' }).textContent).toContain('A to Z');
  expect(screen.getByLabelText('Selected filters').textContent).toBe(
    JSON.stringify({
      provider: 'slack',
      kind: 'message',
      sortBy: 'provider',
      sortDirection: 'asc',
    }),
  );
  expect(screen.getByRole('button', { name: 'Source created: Choose dates' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Source updated: Choose dates' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Reset filters and order' }));
  expect(screen.getByLabelText('Selected filters').textContent).toBe('{}');
});
