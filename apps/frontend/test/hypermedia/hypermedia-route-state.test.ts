import { expect, test } from 'bun:test';
import { displayedHypermediaResourceKinds } from '../../src/components/hypermedia/hypermedia-resource-filter';
import { hypermediaSearch, hypermediaSearchAfterEscape } from '../../src/routes/hypermedia';

test('Hypermedia keeps its scroll month in URL state without a view selector', () => {
  expect(hypermediaSearch({ month: '2025-03' }).month).toBe('2025-03');
  expect(hypermediaSearch({}).month).toBeUndefined();
  expect(hypermediaSearch({ month: '2025-13' }).month).toBeUndefined();
  expect(hypermediaSearch({ view: 'timeline', month: '2025-03' })).toEqual({
    month: '2025-03',
    focus: undefined,
  });
  expect(hypermediaSearch({ view: 'timeline' })).toEqual({ focus: undefined });
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
