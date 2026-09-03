// biome-ignore-all lint/complexity/useMaxParams: Small fixture helpers keep invariant tests readable.
// biome-ignore-all lint/style/noMagicNumbers: Viewport values document the production density thresholds under test.

import { describe, expect, test } from 'bun:test';
import {
  buildHypermediaLayout,
  buildStableLandmarks,
} from '../../src/components/hypermedia/hypermedia-layout';
import {
  focusedLandmarks,
  focusedPageLimit,
  hypermediaLayoutInViewport,
} from '../../src/components/hypermedia/hypermedia-visibility';
import type {
  HypermediaPage,
  HypermediaResource,
  HypermediaResourceNeighborhood,
} from '../../src/queries/hypermedia';

const createdAt = new Date('2026-01-01T00:00:00.000Z');

function entity(readableId: string, isSelf = false): HypermediaResource {
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
  test('never moves landmarks when another resource neighborhood is appended', () => {
    const self = entity('self', true);
    const alpha = entity('alpha');
    const initial = buildStableLandmarks([neighborhood(self, [alpha])]);
    const expanded = buildStableLandmarks([
      neighborhood(self, [alpha]),
      neighborhood(alpha, [entity('beta')]),
    ]);

    for (const landmark of initial) {
      expect(expanded.find(({ key }) => key === landmark.key)?.point).toEqual(landmark.point);
    }
  });

  test('focus follows the viewport while retaining a selected landmark', () => {
    const landmarks = buildStableLandmarks([
      neighborhood(entity('self', true), [entity('alpha'), entity('beta')]),
    ]);
    const beta = landmarks.find(({ key }) => key === 'entity:beta')!;
    const viewport = { x: beta.point.x - 50, y: beta.point.y - 50, width: 100, height: 100 };

    expect(focusedLandmarks({ landmarks, viewport })[0]).toEqual({
      kind: 'entity',
      readableId: 'beta',
    });
    expect(focusedLandmarks({ landmarks, viewport, selectedKey: 'entity:self' })[0]).toEqual({
      kind: 'entity',
      readableId: 'self',
    });
  });

  test('requests progressively more page information as the viewport zooms out', () => {
    expect(focusedPageLimit({ x: 0, y: 0, width: 600, height: 400 })).toBe(4);
    expect(focusedPageLimit({ x: 0, y: 0, width: 900, height: 600 })).toBe(8);
    expect(focusedPageLimit({ x: 0, y: 0, width: 1400, height: 900 })).toBe(16);
    expect(focusedPageLimit({ x: 0, y: 0, width: 2200, height: 1400 })).toBe(32);
  });

  test('viewport culling cannot remove the selected page or landmark', () => {
    const landmarks = buildStableLandmarks([neighborhood(entity('self', true), [entity('alpha')])]);
    const layout = buildHypermediaLayout(landmarks, [page('selected-page')]);
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
      }).landmarks.map(({ key }) => key),
    ).toEqual(['entity:self']);
  });
});
