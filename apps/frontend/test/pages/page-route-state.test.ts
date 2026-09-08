import { expect, test } from 'bun:test';
import { pageListFilters, pageSearch } from '../../src/routes/pages';

test('Pages search, type, and date filters are canonical URL state', () => {
  const search = pageSearch({
    q: '  launch  ',
    pageType: 'temporal',
    from: '2025-03-01',
    to: '2025-08-31',
  });

  expect(search).toEqual({
    q: 'launch',
    pageType: 'temporal',
    from: '2025-03-01',
    to: '2025-08-31',
  });
  expect(pageListFilters(search)).toEqual({
    query: 'launch',
    kind: 'temporal',
    dateRange: { from: '2025-03-01', to: '2025-08-31' },
  });
});

test('Pages discards invalid or empty filter state', () => {
  expect(pageSearch({ q: '  ', pageType: 'archived', from: 'not-a-date' })).toEqual({});
});
