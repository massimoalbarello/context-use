import { expect, test } from 'bun:test';
import { pageListFilters, pageSearch } from '../../src/routes/pages';

test('Pages search, interval, and date filters are canonical URL state', () => {
  const search = pageSearch({
    q: '  launch  ',
    interval: 'with',
    from: '2025-03-01',
    to: '2025-08-31',
  });

  expect(search).toEqual({
    q: 'launch',
    interval: 'with',
    from: '2025-03-01',
    to: '2025-08-31',
  });
  expect(pageListFilters(search)).toEqual({
    query: 'launch',
    interval: 'with',
    dateRange: { from: '2025-03-01', to: '2025-08-31' },
  });
});

test('Pages discards invalid or empty filter state', () => {
  expect(pageSearch({ q: '  ', interval: 'sometimes', from: 'not-a-date' })).toEqual({});
});
