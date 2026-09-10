import { expect, test } from 'bun:test';
import { displayedHypermediaResourceKinds } from '../../src/components/hypermedia/hypermedia-resource-filter';
import {
  hypermediaActiveMonth,
  hypermediaSearch,
  hypermediaSearchAfterEscape,
  hypermediaView,
} from '../../src/routes/hypermedia';

test('Hypermedia view and month are canonical URL state', () => {
  const timelineSearch = hypermediaSearch({
    view: 'timeline',
    month: '2025-03',
  });
  expect(hypermediaView(timelineSearch)).toBe('timeline');
  expect(hypermediaActiveMonth({ search: timelineSearch })).toBe('2025-03');
  expect(timelineSearch).toMatchObject({
    view: 'timeline',
    month: '2025-03',
  });

  const defaultSearch = hypermediaSearch({ view: 'unknown' });
  expect(hypermediaView(defaultSearch)).toBe('map');
  expect(hypermediaActiveMonth({ search: defaultSearch })).toBeUndefined();
  expect(defaultSearch.view).toBeUndefined();
  expect(
    hypermediaActiveMonth({
      search: hypermediaSearch({ view: 'timeline' }),
      now: new Date('2026-09-10T12:00:00.000Z'),
    }),
  ).toBe('2026-09');
  expect(hypermediaSearch({ month: '2025-13' }).month).toBeUndefined();
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
