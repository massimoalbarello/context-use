import { describe, expect, test } from 'bun:test';
import {
  removeHypermediaResourceSelection,
  selectedHypermediaResources,
  selectedHypermediaResourcesLabel,
  selectedHypermediaResourcesValue,
  toggleHypermediaResourceSelection,
} from '../../src/components/hypermedia/hypermedia-selection';

describe('Hypermedia resource filters', () => {
  test('accumulates canonical entity selections without page previews changing them', () => {
    const entitySelection = { kind: 'entity' as const, readableId: 'jun-park' };
    const initial = selectedHypermediaResources(
      'entity:jun-park,entity:jun-park,asset:ignored,record:ignored,invalid',
    );
    const withSecondEntity = toggleHypermediaResourceSelection({
      resources: initial,
      selection: { kind: 'entity', readableId: 'rollout-metrics' },
    });

    expect(initial).toEqual([{ kind: 'entity', readableId: 'jun-park' }]);
    expect(withSecondEntity).toEqual([
      { kind: 'entity', readableId: 'jun-park' },
      { kind: 'entity', readableId: 'rollout-metrics' },
    ]);
    expect(
      toggleHypermediaResourceSelection({
        resources: withSecondEntity,
        selection: { kind: 'page', readableId: 'preview-cache-strategy' },
      }),
    ).toBe(withSecondEntity);
    expect(selectedHypermediaResourcesValue(withSecondEntity)).toBe(
      'entity:jun-park,entity:rollout-metrics',
    );
    expect(selectedHypermediaResourcesLabel(initial)).toBe('1 entity selected');
    expect(selectedHypermediaResourcesLabel([withSecondEntity[1]!])).toBe('1 entity selected');
    expect(selectedHypermediaResourcesLabel(withSecondEntity)).toBe('2 entities selected');
    expect(
      toggleHypermediaResourceSelection({
        resources: withSecondEntity,
        selection: entitySelection,
      }),
    ).toEqual([{ kind: 'entity', readableId: 'rollout-metrics' }]);
  });

  test('removes only the current resource and leaves page previews out of resource state', () => {
    const resources = selectedHypermediaResources(
      'entity:jun-park,entity:rollout-metrics,entity:maya-chen',
    );

    expect(
      removeHypermediaResourceSelection({
        resources,
        selection: { kind: 'entity', readableId: 'rollout-metrics' },
      }),
    ).toEqual([
      { kind: 'entity', readableId: 'jun-park' },
      { kind: 'entity', readableId: 'maya-chen' },
    ]);
    expect(
      removeHypermediaResourceSelection({
        resources,
        selection: { kind: 'page', readableId: 'launch-plan' },
      }),
    ).toBe(resources);
  });
});
