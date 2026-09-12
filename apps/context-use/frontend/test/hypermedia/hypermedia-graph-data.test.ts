import { expect, test } from 'bun:test';
import {
  appendNeighborhoodRequests,
  HYPERMEDIA_EXPANSION_BATCH_SIZE,
  mergeHypermediaNeighborhoods,
} from '../../src/components/hypermedia/hypermedia-graph-data';
import { buildStableEntities } from '../../src/components/hypermedia/hypermedia-layout';
import type { HypermediaEntity, HypermediaNeighborhoods } from '../../src/queries/hypermedia';

function entity(readableId: string): HypermediaEntity {
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  return {
    readableId,
    name: readableId,
    description: readableId,
    entityType: null,
    isSelf: false,
    image: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test('new batches do not regroup completed requests and repeated discovery is deduplicated', () => {
  const self = { anchor: { readableId: 'self' } };
  const initial = appendNeighborhoodRequests({ current: [], requests: [self, self] });
  expect(initial).toEqual([[self]]);
  const requests = [...Array(HYPERMEDIA_EXPANSION_BATCH_SIZE + 1).keys()].map((index) => ({
    anchor: { readableId: `entity-${index}` },
  }));
  const expanded = appendNeighborhoodRequests({ current: initial, requests: [self, ...requests] });
  expect(expanded[0]).toBe(initial[0]);
  expect(expanded[1]).toHaveLength(HYPERMEDIA_EXPANSION_BATCH_SIZE);
  expect(expanded[2]).toHaveLength(1);
  expect(appendNeighborhoodRequests({ current: expanded, requests })).toBe(expanded);
  const next = { ...self, cursor: 'next-self-page' };
  const continued = appendNeighborhoodRequests({ current: expanded, requests: [next, next] });
  expect(continued.at(-1)).toEqual([next]);
});

test('overlapping responses merge identities and undirected edges without adding their counts', () => {
  const first: HypermediaNeighborhoods = {
    entities: [entity('self'), entity('alpha'), entity('beta')],
    neighborhoods: [
      {
        anchor: { readableId: 'self' },
        available: true,
        neighbors: [{ entity: { readableId: 'alpha' }, sharedPageCount: 1 }],
        nextCursor: null,
      },
    ],
    relationships: [
      { source: { readableId: 'self' }, target: { readableId: 'alpha' }, sharedPageCount: 1 },
      { source: { readableId: 'alpha' }, target: { readableId: 'beta' }, sharedPageCount: 2 },
    ],
    relationshipsTruncated: false,
  };
  const second: HypermediaNeighborhoods = {
    entities: [entity('alpha'), entity('beta')],
    neighborhoods: [
      { anchor: { readableId: 'alpha' }, available: true, neighbors: [], nextCursor: null },
      { anchor: { readableId: 'missing' }, available: false, neighbors: [], nextCursor: null },
    ],
    relationships: [
      { source: { readableId: 'beta' }, target: { readableId: 'alpha' }, sharedPageCount: 2 },
    ],
    relationshipsTruncated: false,
  };
  const merged = mergeHypermediaNeighborhoods([first, second]);
  expect(merged.map(({ anchor }) => anchor.readableId)).toEqual(['self', 'alpha', 'beta']);
  expect(merged.find(({ anchor }) => anchor.readableId === 'alpha')?.neighbors).toEqual([
    { entity: second.entities[1]!, sharedPageCount: 2 },
    { entity: first.entities[0]!, sharedPageCount: 1 },
  ]);
  const initial = buildStableEntities(mergeHypermediaNeighborhoods([first]));
  const expanded = buildStableEntities(merged, [], initial);
  for (const placed of initial) {
    expect(expanded.find(({ key }) => key === placed.key)?.point).toEqual(placed.point);
  }
});
