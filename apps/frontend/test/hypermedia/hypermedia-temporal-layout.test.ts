import { describe, expect, test } from 'bun:test';
import {
  buildHypermediaLayout,
  type HypermediaLayoutResource,
} from '../../src/components/hypermedia/hypermedia-layout';
import {
  buildTemporalHypermediaLayout,
  temporalRangeForViewport,
  temporalScrollTopForRange,
} from '../../src/components/hypermedia/hypermedia-temporal-layout';
import type { HypermediaPage } from '../../src/queries/hypermedia';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const extent = {
  start: Date.parse('2020-01-01T00:00:00.000Z'),
  end: Date.parse('2026-12-31T00:00:00.000Z'),
};
const EXPECTED_CLOUD_HEIGHT = 48;
const MINIMUM_CLOUD_GAP = 8;
const DENSE_PAGE_COUNT = 10;

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

  test('stacks overlapping page clouds at the same time while keeping each page thin', () => {
    const densePages = [...Array(DENSE_PAGE_COUNT).keys()].map((index) =>
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
  });

  test('maps vertical scrolling to a reverse-chronological date interval', () => {
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
    const range = { from: '2024-01-01', to: '2025-01-01' };
    const scrollTop = temporalScrollTopForRange({ layout, range, viewportHeight });
    const visible = temporalRangeForViewport({ layout, scrollTop, viewportHeight });

    expect(visible.from <= range.from).toBe(true);
    expect(visible.to >= range.to).toBe(true);
    expect(temporalRangeForViewport({ layout, scrollTop: 0, viewportHeight }).to).toBe(
      '2026-12-31',
    );
    expect(
      temporalRangeForViewport({
        layout,
        scrollTop: layout.height - viewportHeight,
        viewportHeight,
      }).from,
    ).toBe('2020-01-01');
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
