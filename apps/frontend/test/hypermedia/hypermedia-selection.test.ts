import { describe, expect, test } from 'bun:test';
import {
  selectedHypermediaResources,
  selectedHypermediaResourcesLabel,
  selectedHypermediaResourcesValue,
  toggleHypermediaResourceSelection,
} from '../../src/components/hypermedia/hypermedia-selection';

describe('Hypermedia resource filters', () => {
  test('accumulates canonical entity and asset selections without page previews changing them', () => {
    const entitySelection = { kind: 'entity' as const, readableId: 'jun-park' };
    const initial = selectedHypermediaResources('entity:jun-park,entity:jun-park,invalid');
    const withAsset = toggleHypermediaResourceSelection({
      resources: initial,
      selection: { kind: 'asset', readableId: 'rollout-metrics' },
    });

    expect(initial).toEqual([{ kind: 'entity', readableId: 'jun-park' }]);
    expect(withAsset).toEqual([
      { kind: 'entity', readableId: 'jun-park' },
      { kind: 'asset', readableId: 'rollout-metrics' },
    ]);
    expect(
      toggleHypermediaResourceSelection({
        resources: withAsset,
        selection: { kind: 'page', readableId: 'preview-cache-strategy' },
      }),
    ).toBe(withAsset);
    expect(selectedHypermediaResourcesValue(withAsset)).toBe(
      'entity:jun-park,asset:rollout-metrics',
    );
    expect(selectedHypermediaResourcesLabel(initial)).toBe('1 entity selected');
    expect(selectedHypermediaResourcesLabel([withAsset[1]!])).toBe('1 asset selected');
    expect(selectedHypermediaResourcesLabel(withAsset)).toBe('2 resources selected');
    expect(
      toggleHypermediaResourceSelection({ resources: withAsset, selection: entitySelection }),
    ).toEqual([{ kind: 'asset', readableId: 'rollout-metrics' }]);
  });
});
