import { expect, test } from 'bun:test';
import {
  hypermediaProjection,
  hypermediaSearch,
  hypermediaSearchWithDateRange,
} from '../../src/routes/hypermedia';

test('Hypermedia projection and temporal viewport are canonical URL state', () => {
  const temporalSearch = hypermediaSearch({
    view: 'temporal',
    from: '2025-03-01',
    to: '2025-08-31',
  });
  expect(hypermediaProjection(temporalSearch)).toBe('temporal');
  expect(temporalSearch).toMatchObject({
    view: 'temporal',
    from: '2025-03-01',
    to: '2025-08-31',
  });

  const defaultSearch = hypermediaSearch({ view: 'unknown' });
  expect(hypermediaProjection(defaultSearch)).toBe('semantic');
  expect(defaultSearch.view).toBeUndefined();
  expect(
    hypermediaSearchWithDateRange({
      previous: { view: 'temporal', q: 'launch' },
      nextRange: { from: '2024-01-01', to: '2024-12-31' },
    }),
  ).toEqual({
    view: 'temporal',
    q: 'launch',
    from: '2024-01-01',
    to: '2024-12-31',
  });
});
