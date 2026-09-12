import { expect, test } from 'bun:test';
import { hypermediaSearch, hypermediaSearchAfterEscape } from '../../src/routes/hypermedia';

test('Hypermedia validates its scroll month in URL state', () => {
  expect(hypermediaSearch({ month: '2025-03' }).month).toBe('2025-03');
  expect(hypermediaSearch({}).month).toBeUndefined();
  expect(hypermediaSearch({ month: '2025-13' }).month).toBeUndefined();
});

test('Hypermedia accepts only entity and page URL selections', () => {
  expect(
    hypermediaSearch({
      show: 'assets',
      kind: 'asset',
      id: 'chart',
      focus: 'asset:chart,entity:owner',
    }),
  ).toEqual({ focus: 'entity:owner' });
  expect(hypermediaSearch({ kind: 'entity', id: 'owner' })).toMatchObject({
    kind: 'entity',
    id: 'owner',
  });
  expect(hypermediaSearch({ kind: 'page', id: 'notes' })).toMatchObject({
    kind: 'page',
    id: 'notes',
  });
});

test('Escape closes the current preview and deselects only its resource', () => {
  const previous = {
    kind: 'entity' as const,
    id: 'rollout-metrics',
    focus: 'entity:jun-park,entity:rollout-metrics,entity:maya-chen',
  };

  expect(
    hypermediaSearchAfterEscape({
      previous,
      selection: { kind: 'entity', readableId: 'rollout-metrics' },
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
