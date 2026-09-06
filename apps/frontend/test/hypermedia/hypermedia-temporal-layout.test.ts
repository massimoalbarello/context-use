import { describe, expect, test } from 'bun:test';
import {
  buildHypermediaLayout,
  type HypermediaLayoutResource,
} from '../../src/components/hypermedia/hypermedia-layout';
import {
  buildTemporalHypermediaLayout,
  temporalRangeForViewport,
  temporalScrollLeftForRange,
} from '../../src/components/hypermedia/hypermedia-temporal-layout';
import type { HypermediaPage } from '../../src/queries/hypermedia';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const extent = {
  start: Date.parse('2020-01-01T00:00:00.000Z'),
  end: Date.parse('2026-12-31T00:00:00.000Z'),
};

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
  test('places temporal clouds at their interval and connects every referenced resource row', () => {
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
    expect(layout.pages[0]?.path).toContain('C ');
    expect(layout.pages[0]!.start).toBeLessThan(layout.pages[0]!.end);
  });

  test('maps horizontal scrolling to a stable date interval', () => {
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
    const viewportWidth = 640;
    const range = { from: '2024-01-01', to: '2025-01-01' };
    const scrollLeft = temporalScrollLeftForRange({ layout, range, viewportWidth });
    const visible = temporalRangeForViewport({ layout, scrollLeft, viewportWidth });

    expect(visible.from <= range.from).toBe(true);
    expect(visible.to >= range.to).toBe(true);
    expect(
      temporalRangeForViewport({
        layout,
        scrollLeft: layout.width - viewportWidth,
        viewportWidth,
      }).to,
    ).toBe('2026-12-31');
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
