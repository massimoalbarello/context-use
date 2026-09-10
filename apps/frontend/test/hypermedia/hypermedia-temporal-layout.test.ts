import { describe, expect, test } from 'bun:test';
import {
  buildHypermediaLayout,
  type HypermediaLayoutResource,
} from '../../src/components/hypermedia/hypermedia-layout';
import {
  buildTemporalHypermediaLayout,
  temporalScrollTopForRange,
} from '../../src/components/hypermedia/hypermedia-temporal-layout';
import type { HypermediaPage } from '../../src/queries/hypermedia';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const extent = {
  start: Date.parse('2020-01-01T00:00:00.000Z'),
  end: Date.parse('2026-12-31T00:00:00.000Z'),
};
const EXPECTED_CLOUD_HEIGHT = 32;
const MINIMUM_CLOUD_GAP = 6;
const SEPARATED_PAGE_COUNT = 10;
const DISTRIBUTED_PAGE_COUNT = 5;
const MINIMUM_DISTRIBUTED_SPREAD = 400;
const DENSE_RESOURCE_COUNT = 15;
const INITIAL_TEMPORAL_CANVAS_WIDTH = 1_200;
const MAXIMUM_DENSE_RESOURCE_SPAN = 1_050;

function page({
  readableId,
  temporalCoverage,
  resources,
}: {
  readableId: string;
  temporalCoverage: string | null;
  resources: HypermediaPage['resources'];
}): HypermediaPage {
  return {
    readableId,
    title: readableId,
    excerpt: `${readableId} excerpt`,
    temporalCoverage,
    revisionNumber: 1,
    createdAt,
    updatedAt: createdAt,
    resources,
  };
}

function entity(readableId: string): HypermediaLayoutResource {
  return {
    key: `entity:${readableId}`,
    kind: 'entity',
    entity: {
      readableId,
      name: readableId,
      description: `${readableId} description`,
      isSelf: readableId === 'self',
      image: null,
      createdAt,
      updatedAt: createdAt,
    },
    point: { x: 0, y: 0 },
  };
}

describe('temporal Hypermedia side projection', () => {
  test('spans each temporal page across its referenced resource columns', () => {
    const layout = buildTemporalHypermediaLayout({
      resources: [entity('self'), entity('collaborator')],
      pages: [
        page({
          readableId: 'semantic-page',
          temporalCoverage: null,
          resources: [{ kind: 'entity', readableId: 'self' }],
        }),
        page({
          readableId: 'temporal-page',
          temporalCoverage: '2024-03/2025-08',
          resources: [
            { kind: 'entity', readableId: 'self' },
            { kind: 'entity', readableId: 'collaborator' },
            { kind: 'asset', readableId: 'project-plan' },
          ],
        }),
      ],
      extent,
    });

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]?.page.readableId).toBe('temporal-page');
    expect(layout.pages[0]?.resourceKeys).toEqual([
      'entity:self',
      'entity:collaborator',
      'asset:project-plan',
    ]);
    expect(layout.resources.map(({ key }) => key)).toEqual([
      'entity:self',
      'entity:collaborator',
      'asset:project-plan',
    ]);
    expect(layout.resources[2]?.label).toBe('Project Plan');
    expect(layout.resources[0]!.x).toBeLessThan(layout.resources[1]!.x);
    for (const resource of layout.resources) {
      expect(resource.x).toBeGreaterThanOrEqual(layout.pages[0]!.bounds.left);
      expect(resource.x).toBeLessThanOrEqual(layout.pages[0]!.bounds.right);
    }
    expect(layout.pages[0]?.path).toContain('A ');
    expect(layout.pages[0]!.bounds.bottom - layout.pages[0]!.bounds.top).toBe(
      EXPECTED_CLOUD_HEIGHT,
    );
    expect(layout.ticks[0]!.time).toBeGreaterThan(layout.ticks.at(-1)!.time);
    expect(layout.ticks[0]!.y).toBeLessThan(layout.ticks.at(-1)!.y);
  });

  test('packs many resource columns into the initial canvas width', () => {
    const resources = [...Array(DENSE_RESOURCE_COUNT).keys()].map((index) =>
      entity(`resource-${index}`),
    );
    const layout = buildTemporalHypermediaLayout({ resources, pages: [], extent });

    expect(layout.width).toBe(INITIAL_TEMPORAL_CANVAS_WIDTH);
    expect(layout.resources).toHaveLength(DENSE_RESOURCE_COUNT);
    expect(layout.resources.at(-1)!.x - layout.resources[0]!.x).toBeLessThan(
      MAXIMUM_DENSE_RESOURCE_SPAN,
    );
  });

  test('separates dense page clouds when their asserted interval has room', () => {
    const densePages = [...Array(SEPARATED_PAGE_COUNT).keys()].map((index) =>
      page({
        readableId: `temporal-page-${index}`,
        temporalCoverage: '2025-03/2025-08',
        resources: [
          { kind: 'entity', readableId: 'self' },
          { kind: 'entity', readableId: 'collaborator' },
        ],
      }),
    );
    const layout = buildTemporalHypermediaLayout({
      resources: [entity('self'), entity('collaborator')],
      pages: densePages,
      extent,
    });

    expect(layout.pages).toHaveLength(densePages.length);
    for (const [index, first] of layout.pages.entries()) {
      expect(first.bounds.bottom - first.bounds.top).toBe(EXPECTED_CLOUD_HEIGHT);
      expect(first.bounds.right - first.bounds.left).toBeGreaterThan(
        first.bounds.bottom - first.bounds.top,
      );
      for (const second of layout.pages.slice(index + 1)) {
        const horizontalOverlap =
          first.bounds.left < second.bounds.right && first.bounds.right > second.bounds.left;
        if (!horizontalOverlap) {
          continue;
        }
        const verticalGap = second.bounds.top - first.bounds.bottom;
        expect(verticalGap).toBeGreaterThanOrEqual(MINIMUM_CLOUD_GAP);
      }
    }
    const newerEdge = temporalScrollTopForRange({
      layout,
      range: { from: '2025-08-31', to: '2025-08-31' },
      viewportHeight: 0,
    });
    const olderEdge = temporalScrollTopForRange({
      layout,
      range: { from: '2025-03-01', to: '2025-03-01' },
      viewportHeight: 0,
    });
    expect(layout.pages.every(({ label }) => label.y >= newerEdge && label.y <= olderEdge)).toBe(
      true,
    );
    expect(layout.hasOverlappingPages).toBe(false);
    expect(layout.pageLoadBoundaryY).toBe(
      Math.max(...layout.pages.map(({ bounds }) => bounds.bottom)),
    );
  });

  test('distributes longer-lived pages across their asserted interval', () => {
    const distributedResources = [...Array(DISTRIBUTED_PAGE_COUNT).keys()].map((index) =>
      entity(`resource-${index}`),
    );
    const layout = buildTemporalHypermediaLayout({
      resources: distributedResources,
      pages: distributedResources.map((resource) =>
        page({
          readableId: `long-lived-page-${resource.key}`,
          temporalCoverage: '2021/2026',
          resources: [{ kind: 'entity', readableId: resource.key.slice('entity:'.length) }],
        }),
      ),
      extent,
    });
    const pageCenters = layout.pages.map(({ label }) => label.y);

    expect(new Set(pageCenters).size).toBe(DISTRIBUTED_PAGE_COUNT);
    expect(Math.max(...pageCenters) - Math.min(...pageCenters)).toBeGreaterThan(
      MINIMUM_DISTRIBUTED_SPREAD,
    );
  });

  test('keeps an irreducible same-day collision anchored to the asserted date', () => {
    const layout = buildTemporalHypermediaLayout({
      resources: [entity('self')],
      pages: ['first', 'second'].map((readableId) =>
        page({
          readableId,
          temporalCoverage: '2025-08-25',
          resources: [{ kind: 'entity', readableId: 'self' }],
        }),
      ),
      extent,
    });

    expect(layout.pages[0]?.label.y).toBe(layout.pages[1]?.label.y);
    expect(layout.hasOverlappingPages).toBe(true);
  });

  test('maps selected intervals to reverse-chronological vertical positions', () => {
    const layout = buildTemporalHypermediaLayout({
      resources: [entity('self')],
      pages: [
        page({
          readableId: 'temporal-page',
          temporalCoverage: '2025',
          resources: [{ kind: 'entity', readableId: 'self' }],
        }),
      ],
      extent,
    });
    const viewportHeight = 640;
    const recent = temporalScrollTopForRange({
      layout,
      range: { from: '2025-06-01', to: '2025-06-30' },
      viewportHeight,
    });
    const older = temporalScrollTopForRange({
      layout,
      range: { from: '2024-06-01', to: '2024-06-30' },
      viewportHeight,
    });

    expect(temporalScrollTopForRange({ layout, viewportHeight })).toBe(0);
    expect(older).toBeGreaterThan(recent);
  });

  test('keeps a page visual identity stable across both projections', () => {
    const resource = entity('self');
    const temporalPage = page({
      readableId: 'temporal-page',
      temporalCoverage: '2025',
      resources: [{ kind: 'entity', readableId: 'self' }],
    });

    const semanticLayout = buildHypermediaLayout([resource], [temporalPage]);
    const temporalLayout = buildTemporalHypermediaLayout({
      resources: [resource],
      pages: [temporalPage],
      extent,
    });

    expect(temporalLayout.pages[0]?.colorIndex).toBe(semanticLayout.pages[0]?.colorIndex);
  });
});
