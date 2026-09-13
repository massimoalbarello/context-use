import { describe, expect, test } from 'bun:test';
import {
  removeHypermediaEntitySelection,
  selectedHypermediaEntities,
  selectedHypermediaEntitiesValue,
  toggleHypermediaEntitySelection,
} from '../../src/components/hypermedia/hypermedia-selection';

describe('Hypermedia entity filters', () => {
  test('accumulates canonical entity selections without page previews changing them', () => {
    const entitySelection = { kind: 'entity' as const, readableId: 'jun-park' };
    const initial = selectedHypermediaEntities(
      'entity:jun-park,entity:jun-park,asset:ignored,record:ignored,invalid',
    );
    const withSecondEntity = toggleHypermediaEntitySelection({
      entities: initial,
      selection: { kind: 'entity', readableId: 'rollout-metrics' },
    });

    expect(initial).toEqual([{ readableId: 'jun-park' }]);
    expect(withSecondEntity).toEqual([
      { readableId: 'jun-park' },
      { readableId: 'rollout-metrics' },
    ]);
    expect(
      toggleHypermediaEntitySelection({
        entities: withSecondEntity,
        selection: { kind: 'page', readableId: 'preview-cache-strategy' },
      }),
    ).toBe(withSecondEntity);
    expect(selectedHypermediaEntitiesValue(withSecondEntity)).toBe(
      'entity:jun-park,entity:rollout-metrics',
    );
    expect(
      toggleHypermediaEntitySelection({
        entities: withSecondEntity,
        selection: entitySelection,
      }),
    ).toEqual([{ readableId: 'rollout-metrics' }]);
  });

  test('removes only the current entity and leaves page previews out of entity state', () => {
    const entities = selectedHypermediaEntities(
      'entity:jun-park,entity:rollout-metrics,entity:maya-chen',
    );

    expect(
      removeHypermediaEntitySelection({
        entities,
        selection: { kind: 'entity', readableId: 'rollout-metrics' },
      }),
    ).toEqual([{ readableId: 'jun-park' }, { readableId: 'maya-chen' }]);
    expect(
      removeHypermediaEntitySelection({
        entities,
        selection: { kind: 'page', readableId: 'launch-plan' },
      }),
    ).toBe(entities);
  });
});
