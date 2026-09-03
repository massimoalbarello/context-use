// biome-ignore-all lint/complexity/useMaxParams: Small fixture helpers keep invariant tests readable.
// biome-ignore-all lint/style/noMagicNumbers: Viewport values document the production density thresholds under test.

import { describe, expect, test } from 'bun:test';
import {
  buildHypermediaLayout,
  buildStableResources,
} from '../../src/components/hypermedia/hypermedia-layout';
import {
  focusedPageLimit,
  focusedResources,
  hypermediaLayoutInViewport,
  viewportNeedsResourceDiscovery,
} from '../../src/components/hypermedia/hypermedia-visibility';
import type {
  HypermediaPage,
  HypermediaResource,
  HypermediaResourceNeighborhood,
} from '../../src/queries/hypermedia';

const createdAt = new Date('2026-01-01T00:00:00.000Z');

function entity(
  readableId: string,
  isSelf = false,
): Extract<HypermediaResource, { kind: 'entity' }> {
  return {
    kind: 'entity',
    entity: {
      readableId,
      name: readableId,
      description: `${readableId} description`,
      isSelf,
      image: null,
      createdAt,
      updatedAt: createdAt,
    },
  };
}

function neighborhood(
  anchor: HypermediaResource,
  neighbors: HypermediaResource[],
): HypermediaResourceNeighborhood {
  return {
    anchor,
    neighbors: neighbors.map((resource) => ({ resource, sharedPageCount: 1 })),
    nextCursor: null,
  };
}

function page(readableId: string): HypermediaPage {
  return {
    readableId,
    title: readableId,
    excerpt: `${readableId} excerpt`,
    temporalCoverage: null,
    revisionNumber: 1,
    createdAt,
    updatedAt: createdAt,
    resources: [
      { kind: 'entity', readableId: 'self' },
      { kind: 'entity', readableId: 'alpha' },
    ],
  };
}

describe('resource-first hypermedia layout', () => {
  test('never moves resources when another neighborhood is appended', () => {
    const self = entity('self', true);
    const alpha = entity('alpha');
    const initial = buildStableResources([neighborhood(self, [alpha])]);
    const expanded = buildStableResources([
      neighborhood(self, [alpha]),
      neighborhood(alpha, [entity('beta')]),
    ]);

    for (const resource of initial) {
      expect(expanded.find(({ key }) => key === resource.key)?.point).toEqual(resource.point);
    }
  });

  test('keeps every listed entity on the map without moving earlier discoveries', () => {
    const self = entity('self', true);
    const alpha = entity('alpha');
    const orphan = entity('orphan');
    const initial = buildStableResources(
      [neighborhood(self, [alpha])],
      [self.entity, alpha.entity, orphan.entity],
    );
    const expanded = buildStableResources(
      [neighborhood(self, [alpha]), neighborhood(alpha, [entity('beta')])],
      [self.entity, alpha.entity, orphan.entity, entity('zeta').entity],
      initial,
    );

    expect(initial.map(({ key }) => key)).toContain('entity:orphan');
    for (const resource of initial) {
      expect(expanded.find(({ key }) => key === resource.key)?.point).toEqual(resource.point);
    }
  });

  test('focus follows the viewport while retaining a selected resource', () => {
    const resources = buildStableResources([
      neighborhood(entity('self', true), [entity('alpha'), entity('beta')]),
    ]);
    const beta = resources.find(({ key }) => key === 'entity:beta')!;
    const viewport = { x: beta.point.x - 50, y: beta.point.y - 50, width: 100, height: 100 };

    expect(focusedResources({ resources, viewport })[0]).toEqual({
      kind: 'entity',
      readableId: 'beta',
    });
    expect(focusedResources({ resources, viewport, selectedKey: 'entity:self' })[0]).toEqual({
      kind: 'entity',
      readableId: 'self',
    });
    expect(focusedResources({ resources, viewport })).toHaveLength(1);
  });

  test('requests progressively more page history as the viewport zooms in', () => {
    expect(focusedPageLimit({ x: 0, y: 0, width: 600, height: 400 })).toBe(32);
    expect(focusedPageLimit({ x: 0, y: 0, width: 900, height: 600 })).toBe(20);
    expect(focusedPageLimit({ x: 0, y: 0, width: 1400, height: 900 })).toBe(16);
    expect(focusedPageLimit({ x: 0, y: 0, width: 1750, height: 1100 })).toBe(12);
    expect(focusedPageLimit({ x: 0, y: 0, width: 2200, height: 1400 })).toBe(8);
    expect(focusedPageLimit({ x: 0, y: 0, width: 2600, height: 1600 })).toBe(4);
  });

  test('discovers another neighborhood only at a sparse map edge', () => {
    const resources = buildStableResources([
      neighborhood(entity('self', true), [entity('alpha'), entity('beta'), entity('gamma')]),
    ]).map((resource, index) => ({ ...resource, point: { x: index * 40, y: 0 } }));
    const bounds = { x: -100, y: -100, width: 500, height: 200 };

    expect(viewportNeedsResourceDiscovery({ resources, viewport: bounds, bounds })).toBe(false);
    expect(
      viewportNeedsResourceDiscovery({
        resources,
        viewport: { x: bounds.x + bounds.width, y: bounds.y, width: 500, height: 200 },
        bounds,
      }),
    ).toBe(true);
    expect(
      viewportNeedsResourceDiscovery({
        resources,
        viewport: { x: -750, y: -500, width: 1500, height: 1000 },
        bounds,
      }),
    ).toBe(true);
  });

  test('viewport culling cannot remove the selected page or resource', () => {
    const resources = buildStableResources([neighborhood(entity('self', true), [entity('alpha')])]);
    const layout = buildHypermediaLayout(resources, [page('selected-page')]);
    const hiddenViewport = { x: 10_000, y: 10_000, width: 100, height: 100 };

    expect(
      hypermediaLayoutInViewport({
        layout,
        viewport: hiddenViewport,
        selectedKey: 'page:selected-page',
      }).pages.map(({ page: item }) => item.readableId),
    ).toEqual(['selected-page']);
    expect(
      hypermediaLayoutInViewport({
        layout,
        viewport: hiddenViewport,
        selectedKey: 'entity:self',
      }).resources.map(({ key }) => key),
    ).toEqual(['entity:self']);
  });
});
