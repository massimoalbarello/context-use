import { expect, test } from 'bun:test';
import { mapSearch } from '../../src/routes/map';

test('Map validates its scroll month in URL state', () => {
  expect(mapSearch({ month: '2025-03' }).month).toBe('2025-03');
  expect(mapSearch({}).month).toBeUndefined();
  expect(mapSearch({ month: '2025-13' }).month).toBeUndefined();
});

test('Map can inspect every resource type without changing the canvas route', () => {
  for (const resource of ['entity', 'page', 'asset', 'record'] as const) {
    expect(mapSearch({ resource, resourceId: 'notes', expanded: true })).toEqual({
      resource,
      resourceId: 'notes',
      expanded: true,
    });
  }
  expect(mapSearch({ resource: 'unknown', resourceId: 'notes' })).toEqual({});
  expect(mapSearch({ resource: 'page', resourceId: ' ' })).toEqual({});
});
