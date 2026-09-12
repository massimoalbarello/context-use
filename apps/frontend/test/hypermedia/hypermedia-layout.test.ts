// biome-ignore-all lint/complexity/useMaxParams: Small fixture helpers keep invariant tests readable.
// biome-ignore-all lint/style/noMagicNumbers: Viewport values document the production density thresholds under test.

import { describe, expect, test } from 'bun:test';
import {
  buildHypermediaLayout,
  buildStableEntities,
  zoomedHypermediaViewBox,
} from '../../src/components/hypermedia/hypermedia-layout';
import {
  focusedEntities,
  hypermediaLayoutInViewport,
  viewportNeedsEntityDiscovery,
} from '../../src/components/hypermedia/hypermedia-visibility';
import type {
  HypermediaEntity,
  HypermediaEntityNeighborhood,
  HypermediaPage,
} from '../../src/queries/hypermedia';

const createdAt = new Date('2026-01-01T00:00:00.000Z');

function entity(readableId: string, isSelf = false): HypermediaEntity {
  return {
    readableId,
    name: readableId,
    description: `${readableId} description`,
    isSelf,
    entityType: null,
    image: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function neighborhood(
  anchor: HypermediaEntity,
  neighbors: HypermediaEntity[],
): HypermediaEntityNeighborhood {
  return {
    anchor,
    neighbors: neighbors.map((entity) => ({ entity, sharedPageCount: 1 })),
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
    entities: [{ readableId: 'self' }, { readableId: 'alpha' }],
  };
}

describe('entity-first hypermedia layout', () => {
  test('never moves entities when another neighborhood is appended', () => {
    const self = entity('self', true);
    const alpha = entity('alpha');
    const initial = buildStableEntities([neighborhood(self, [alpha])]);
    const expanded = buildStableEntities([
      neighborhood(self, [alpha]),
      neighborhood(alpha, [entity('beta')]),
    ]);

    for (const entity of initial) {
      expect(expanded.find(({ key }) => key === entity.key)?.point).toEqual(entity.point);
    }
  });

  test('keeps every listed entity on the map without moving earlier discoveries', () => {
    const self = entity('self', true);
    const alpha = entity('alpha');
    const orphan = entity('orphan');
    const initial = buildStableEntities([neighborhood(self, [alpha])], [self, alpha, orphan]);
    const expanded = buildStableEntities(
      [neighborhood(self, [alpha]), neighborhood(alpha, [entity('beta')])],
      [self, alpha, orphan, entity('zeta')],
      initial,
    );

    expect(initial.map(({ key }) => key)).toContain('entity:orphan');
    for (const entity of initial) {
      expect(expanded.find(({ key }) => key === entity.key)?.point).toEqual(entity.point);
    }
  });

  test('places listed entities before their neighborhoods load', () => {
    const match = entity('diagram');
    const initial = buildStableEntities([], [match]);
    expect(initial.map(({ key }) => key)).toEqual(['entity:diagram']);
    const expanded = buildStableEntities(
      [neighborhood(entity('self', true), [match])],
      [match],
      initial,
    );
    expect(expanded.find(({ key }) => key === 'entity:diagram')?.point).toEqual(initial[0]?.point);
  });

  test('focus follows the viewport while retaining a selected entity', () => {
    const entities = buildStableEntities([
      neighborhood(entity('self', true), [entity('alpha'), entity('beta')]),
    ]);
    const beta = entities.find(({ key }) => key === 'entity:beta')!;
    const viewport = { x: beta.point.x - 50, y: beta.point.y - 50, width: 100, height: 100 };

    expect(focusedEntities({ entities, viewport })[0]).toEqual({
      readableId: 'beta',
    });
    expect(focusedEntities({ entities, viewport, selectedKey: 'entity:self' })[0]).toEqual({
      readableId: 'self',
    });
    expect(focusedEntities({ entities, viewport })).toHaveLength(1);
  });

  test('discovers another neighborhood only at a sparse map edge', () => {
    const entities = buildStableEntities([
      neighborhood(entity('self', true), [entity('alpha'), entity('beta'), entity('gamma')]),
    ]).map((entity, index) => ({ ...entity, point: { x: index * 40, y: 0 } }));
    const bounds = { x: -100, y: -100, width: 500, height: 200 };

    expect(viewportNeedsEntityDiscovery({ entities, viewport: bounds, bounds })).toBe(false);
    expect(
      viewportNeedsEntityDiscovery({
        entities,
        viewport: { x: bounds.x + bounds.width, y: bounds.y, width: 500, height: 200 },
        bounds,
      }),
    ).toBe(true);
    expect(
      viewportNeedsEntityDiscovery({
        entities,
        viewport: { x: -750, y: -500, width: 1500, height: 1000 },
        bounds,
      }),
    ).toBe(true);
  });

  test('viewport culling cannot remove the selected page or entity', () => {
    const entities = buildStableEntities([neighborhood(entity('self', true), [entity('alpha')])]);
    const layout = buildHypermediaLayout(entities, [page('selected-page')]);
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
      }).entities.map(({ key }) => key),
    ).toEqual(['entity:self']);
  });

  test('keeps a page cloud while one of its connected entities remains visible', () => {
    const entities = buildStableEntities([neighborhood(entity('self', true), [])]);
    const layout = buildHypermediaLayout(entities, [page('connected-page')]);
    const connectedPage = layout.pages[0]!;
    const viewport = { x: -50, y: -50, width: 100, height: 100 };
    const displacedLayout = {
      ...layout,
      pages: [{ ...connectedPage, point: { x: 10_000, y: 10_000 } }],
    };

    expect(
      hypermediaLayoutInViewport({ layout: displacedLayout, viewport }).pages.map(
        ({ page: item }) => item.readableId,
      ),
    ).toEqual(['connected-page']);
  });

  test('returns the same view when zoom-out is already clamped at its maximum', () => {
    const current = { x: -1200, y: -800, width: 2400, height: 1600 };

    expect(
      zoomedHypermediaViewBox({
        current,
        factor: 1.1,
        anchor: { x: 0.9, y: 0.1 },
        minimumWidth: 260,
        maximumWidth: 2400,
      }),
    ).toBe(current);
  });
});
