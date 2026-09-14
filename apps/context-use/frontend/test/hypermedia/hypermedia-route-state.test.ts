import { expect, test } from 'bun:test';
import { hypermediaSearch } from '../../src/routes/hypermedia';

test('Hypermedia validates its scroll month in URL state', () => {
  expect(hypermediaSearch({ month: '2025-03' }).month).toBe('2025-03');
  expect(hypermediaSearch({}).month).toBeUndefined();
  expect(hypermediaSearch({ month: '2025-13' }).month).toBeUndefined();
});

test('Hypermedia can inspect every resource type without changing the canvas route', () => {
  for (const resource of ['entity', 'page', 'asset', 'record'] as const) {
    expect(hypermediaSearch({ resource, resourceId: 'notes', expanded: true })).toEqual({
      resource,
      resourceId: 'notes',
      expanded: true,
    });
  }
  expect(hypermediaSearch({ resource: 'unknown', resourceId: 'notes' })).toEqual({});
  expect(hypermediaSearch({ resource: 'page', resourceId: ' ' })).toEqual({});
});
