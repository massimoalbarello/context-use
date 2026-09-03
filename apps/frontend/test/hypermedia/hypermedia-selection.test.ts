import { describe, expect, test } from 'bun:test';
import {
  nextHypermediaSpotlightResource,
  selectedHypermediaResource,
} from '../../src/components/hypermedia/hypermedia-selection';

describe('Hypermedia selection spotlight', () => {
  test('follows resource selections, survives page selections, and ends when the panel closes', () => {
    const entitySelection = { kind: 'entity' as const, readableId: 'jun-park' };
    const entity = selectedHypermediaResource(entitySelection);

    expect(entity).toEqual({ kind: 'entity', readableId: 'jun-park' });
    expect(
      nextHypermediaSpotlightResource({
        current: entity,
        selection: { kind: 'page', readableId: 'preview-cache-strategy' },
      }),
    ).toBe(entity);
    expect(
      nextHypermediaSpotlightResource({
        current: entity,
        selection: { kind: 'asset', readableId: 'rollout-metrics' },
      }),
    ).toEqual({ kind: 'asset', readableId: 'rollout-metrics' });
    expect(nextHypermediaSpotlightResource({ current: entity })).toBeUndefined();
  });
});
