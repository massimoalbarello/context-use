import { expect, test } from 'bun:test';
import { displayedHypermediaResourceKinds } from '../../src/components/hypermedia/hypermedia-resource-filter';
import {
  hypermediaProjection,
  hypermediaSearch,
  hypermediaSearchAfterEscape,
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

test('Hypermedia resource visibility is canonical URL state with entities as the default', () => {
  expect(displayedHypermediaResourceKinds(hypermediaSearch({}).show)).toEqual(['entity']);
  expect(displayedHypermediaResourceKinds(hypermediaSearch({ show: 'assets' }).show)).toEqual([
    'asset',
  ]);
  expect(displayedHypermediaResourceKinds(hypermediaSearch({ show: 'all' }).show)).toEqual([
    'entity',
    'asset',
  ]);
  expect(hypermediaSearch({ show: 'neither' }).show).toBeUndefined();
  expect(hypermediaSearch({ show: 'assets', kind: 'entity', id: 'hidden-entity' })).toEqual({
    show: 'assets',
    focus: undefined,
  });
});

test('Escape closes the current preview and deselects only its resource', () => {
  const previous = {
    kind: 'asset' as const,
    id: 'rollout-metrics',
    focus: 'entity:jun-park,asset:rollout-metrics,entity:maya-chen',
  };

  expect(
    hypermediaSearchAfterEscape({
      previous,
      selection: { kind: 'asset', readableId: 'rollout-metrics' },
    }),
  ).toEqual({
    kind: undefined,
    id: undefined,
    focus: 'entity:jun-park,entity:maya-chen',
  });
  expect(
    hypermediaSearchAfterEscape({
      previous: { ...previous, kind: 'page', id: 'launch-plan' },
      selection: { kind: 'page', readableId: 'launch-plan' },
    }),
  ).toEqual({
    kind: undefined,
    id: undefined,
    focus: previous.focus,
  });
});
