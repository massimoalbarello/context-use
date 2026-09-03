import { describe, expect, test } from 'bun:test';
import {
  buildKnowledgeMapLayout,
  eagerKnowledgeMapImageKeys,
  focusedKnowledgeMapViewBox,
  knowledgeMapLayoutInViewport,
  MAX_EAGER_KNOWLEDGE_MAP_IMAGES,
  mapViewportNearBoundary,
} from '../../src/components/knowledge-map/knowledge-map-layout';
import type {
  KnowledgeMapAsset,
  KnowledgeMapBatch,
  KnowledgeMapEntity,
  KnowledgeMapPage,
} from '../../src/queries/knowledge-map';
import { knowledgeMapFrom, knowledgeMapQueryOptions } from '../../src/queries/knowledge-map';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const MINIMUM_RESOURCE_DISTANCE = 116;
const MINIMUM_PAGE_LABEL_DISTANCE = 180;
const CROWDED_NEIGHBOR_COUNT = 120;
const CROWDED_PAGE_COUNT = 40;
const EXTRA_RASTER_ASSET_COUNT = 4;
const FIRST_TEMPORAL_REVEAL_ZOOM = 1.01;
const FULL_TEMPORAL_REVEAL_ZOOM = 2;

function entity({
  readableId,
  name,
  isSelf = false,
}: {
  readableId: string;
  name: string;
  isSelf?: boolean;
}): KnowledgeMapEntity {
  return {
    readableId,
    name,
    description: `${name} description`,
    isSelf,
    image: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function asset({
  readableId,
  mediaType = 'image/png',
}: {
  readableId: string;
  mediaType?: string;
}): KnowledgeMapAsset {
  return {
    readableId,
    name: `Asset ${readableId}`,
    mediaType,
    extension: mediaType === 'image/png' ? 'png' : 'pdf',
    sizeBytes: 1200,
    createdAt,
    updatedAt: createdAt,
  };
}

function page({
  readableId,
  title,
  ...options
}: {
  readableId: string;
  title: string;
} & Partial<
  Pick<KnowledgeMapPage, 'excerpt' | 'mentions' | 'assetUsages' | 'temporalCoverage'>
>): KnowledgeMapPage {
  return {
    readableId,
    title,
    excerpt: options.excerpt ?? 'A focused account of the subject and its context.',
    temporalCoverage: options.temporalCoverage ?? null,
    revisionNumber: 1,
    createdAt,
    updatedAt: createdAt,
    mentions: options.mentions ?? [],
    assetUsages: options.assetUsages ?? [],
  };
}

describe('knowledge map layout', () => {
  test('keeps one shared entity dot inside both knowledge page regions', () => {
    const sharedEntity = entity({ readableId: 'luca', name: 'Luca' });
    const first = page({ readableId: 'first-page', title: 'First page', mentions: [sharedEntity] });
    const second = page({
      readableId: 'second-page',
      title: 'Second page',
      mentions: [sharedEntity],
    });

    const layout = buildKnowledgeMapLayout([first, second]);

    expect(layout.resources).toHaveLength(1);
    expect(layout.resources[0]?.key).toBe('entity:luca');
    expect(layout.pages.every(({ cloudPath }) => cloudPath.length > 0)).toBe(true);
    expect(layout.pages.every(({ resourceKeys }) => resourceKeys.includes('entity:luca'))).toBe(
      true,
    );
  });

  test('anchors the initial focus on self and keeps resource dots apart', () => {
    const self = entity({ readableId: 'alex', name: 'Alex', isSelf: true });
    const neighbors: KnowledgeMapEntity[] = [];
    for (let index = 0; index < CROWDED_NEIGHBOR_COUNT; index += 1) {
      neighbors.push(entity({ readableId: `neighbor-${index}`, name: `Neighbor ${index}` }));
    }
    const layout = buildKnowledgeMapLayout(
      [
        page({
          readableId: 'crowded-page',
          title: 'Crowded page',
          mentions: [self, ...neighbors],
        }),
      ],
      { anchorEntity: self },
    );
    const selfResource = layout.resources.find(({ key }) => key === 'entity:alex');

    expect(selfResource).toBeDefined();
    expect(layout.focusPoint).toEqual(selfResource!.point);
    expect(selfResource!.point).toEqual({ x: 0, y: 0 });
    for (const [index, resource] of layout.resources.entries()) {
      for (const other of layout.resources.slice(index + 1)) {
        expect(
          Math.hypot(resource.point.x - other.point.x, resource.point.y - other.point.y),
        ).toBeGreaterThanOrEqual(MINIMUM_RESOURCE_DISTANCE);
      }
    }
  });

  test('groups resources introduced together into one qualitative neighborhood', () => {
    const self = entity({ readableId: 'self', name: 'Self', isSelf: true });
    const alpha = entity({ readableId: 'alpha', name: 'Alpha' });
    const beta = entity({ readableId: 'beta', name: 'Beta' });
    const gamma = entity({ readableId: 'gamma', name: 'Gamma' });
    const layout = buildKnowledgeMapLayout(
      [
        page({ readableId: 'shared', title: 'Shared', mentions: [self, alpha, beta] }),
        page({ readableId: 'separate', title: 'Separate', mentions: [self, gamma] }),
      ],
      { anchorEntity: self },
    );
    const pointFor = (readableId: string) =>
      layout.resources.find(({ key }) => key === `entity:${readableId}`)!.point;
    const alphaPoint = pointFor('alpha');
    const distanceFromAlpha = (readableId: string) => {
      const point = pointFor(readableId);
      return Math.hypot(alphaPoint.x - point.x, alphaPoint.y - point.y);
    };

    expect(distanceFromAlpha('beta')).toBeLessThan(distanceFromAlpha('gamma'));
  });

  test('keeps page label centers far enough apart for long titles', () => {
    const pages: KnowledgeMapPage[] = [];
    for (let index = 0; index < CROWDED_PAGE_COUNT; index += 1) {
      pages.push(
        page({
          readableId: `page-${index}`,
          title: `A long knowledge page title ${index}`,
        }),
      );
    }
    const layout = buildKnowledgeMapLayout(pages);

    for (const [index, pageLayout] of layout.pages.entries()) {
      for (const other of layout.pages.slice(index + 1)) {
        expect(
          Math.hypot(pageLayout.point.x - other.point.x, pageLayout.point.y - other.point.y),
        ).toBeGreaterThanOrEqual(MINIMUM_PAGE_LABEL_DISTANCE);
      }
    }
  });

  test('keeps loaded page and resource coordinates stable as later neighborhoods append', () => {
    const self = entity({ readableId: 'alex', name: 'Alex', isSelf: true });
    const shared = entity({ readableId: 'northstar', name: 'Northstar' });
    const firstPages = [
      page({ readableId: 'latest', title: 'Latest', mentions: [self, shared] }),
      page({ readableId: 'recent', title: 'Recent', mentions: [self] }),
    ];
    const initial = buildKnowledgeMapLayout(firstPages, { anchorEntity: self });
    const expanded = buildKnowledgeMapLayout(
      [
        ...firstPages,
        page({
          readableId: 'older',
          title: 'Older',
          mentions: [self, shared, entity({ readableId: 'maya', name: 'Maya' })],
        }),
      ],
      { anchorEntity: self },
    );

    for (const initialPage of initial.pages) {
      const expandedPage = expanded.pages.find(
        ({ page: mapPage }) => mapPage.readableId === initialPage.page.readableId,
      );
      expect(expandedPage?.point).toEqual(initialPage.point);
      expect(expandedPage?.cloudPath).toBe(initialPage.cloudPath);
    }
    for (const initialResource of initial.resources) {
      expect(expanded.resources.find(({ key }) => key === initialResource.key)?.point).toEqual(
        initialResource.point,
      );
    }
  });

  test('requests another neighborhood only near the explored map boundary', () => {
    const bounds = { x: -600, y: -450, width: 1200, height: 900 };

    expect(mapViewportNearBoundary({ x: -120, y: -90, width: 240, height: 180 }, bounds)).toBe(
      false,
    );
    expect(mapViewportNearBoundary({ x: 390, y: -90, width: 240, height: 180 }, bounds)).toBe(true);
  });

  test('shows only the page neighborhoods near the current viewport', () => {
    const self = entity({ readableId: 'alex', name: 'Alex', isSelf: true });
    const pageCount = 12;
    const pages = [...Array(pageCount).keys()].map((index) =>
      page({ readableId: `page-${index}`, title: `Page ${index}`, mentions: [self] }),
    );
    const layout = buildKnowledgeMapLayout(pages, { anchorEntity: self });

    const closeView = knowledgeMapLayoutInViewport(layout, {
      x: -300,
      y: -300,
      width: 600,
      height: 600,
    });
    const fittedView = knowledgeMapLayoutInViewport(layout, layout.bounds);

    expect(closeView.pages.length).toBeLessThan(fittedView.pages.length);
    expect(fittedView.pages).toHaveLength(pages.length);
    expect(closeView.resources.some(({ key }) => key === 'entity:alex')).toBe(true);
  });

  test('reveals temporal pages newest first as the map zooms out', () => {
    const semantic = page({ readableId: 'semantic', title: 'Semantic' });
    const newest = page({
      readableId: 'newest',
      title: 'Newest',
      temporalCoverage: '2026-08/..',
    });
    const middle = page({
      readableId: 'middle',
      title: 'Middle',
      temporalCoverage: '2026-07',
    });
    const oldest = page({
      readableId: 'oldest',
      title: 'Oldest',
      temporalCoverage: '2025',
    });
    const layout = buildKnowledgeMapLayout([semantic, newest, middle, oldest]);
    const focused = focusedKnowledgeMapViewBox(layout);
    const pageIdsAtWidth = (width: number) =>
      knowledgeMapLayoutInViewport(layout, {
        x: layout.bounds.x,
        y: layout.bounds.y,
        width,
        height: layout.bounds.height,
      }).pages.map(({ page: mapPage }) => mapPage.readableId);

    expect(pageIdsAtWidth(focused.width)).toEqual(['semantic']);
    expect(pageIdsAtWidth(focused.width * FIRST_TEMPORAL_REVEAL_ZOOM)).toEqual([
      'semantic',
      'newest',
    ]);
    expect(
      pageIdsAtWidth(Math.max(layout.bounds.width, focused.width * FULL_TEMPORAL_REVEAL_ZOOM)),
    ).toEqual(['semantic', 'newest', 'middle', 'oldest']);
    expect(
      knowledgeMapLayoutInViewport(
        layout,
        {
          x: layout.bounds.x,
          y: layout.bounds.y,
          width: focused.width,
          height: layout.bounds.height,
        },
        'middle',
      ).pages.map(({ page: mapPage }) => mapPage.readableId),
    ).toEqual(['semantic', 'middle']);
  });

  test('merges cursor batches without duplicating a page at their boundary', () => {
    const first = page({ readableId: 'first', title: 'First' });
    const second = page({ readableId: 'second', title: 'Second' });
    const batches: KnowledgeMapBatch[] = [
      { pages: [first], nextCursor: 'next', truncated: false },
      { pages: [first, second], nextCursor: null, truncated: false },
    ];

    expect(knowledgeMapFrom(batches).pages.map(({ readableId }) => readableId)).toEqual([
      'first',
      'second',
    ]);
  });

  test('keeps every server-side map filter in the infinite-query cache key', () => {
    const filteredKey = knowledgeMapQueryOptions({
      query: '  launch  ',
      dateRange: { from: '2026-01-01', to: '2026-03-31' },
    }).queryKey;
    expect(filteredKey[0]).toBe('knowledge-map');
    expect(filteredKey[1]).toEqual({
      query: 'launch',
      time: '2026-01-01/2026-03-31',
    });

    const unfilteredKey = knowledgeMapQueryOptions().queryKey;
    expect(unfilteredKey[0]).toBe('knowledge-map');
    expect(unfilteredKey[1]).toEqual({ query: null, time: null });
  });

  test('bounds eager full-image requests to resources nearest the initial focus', () => {
    const rasterAssets: KnowledgeMapAsset[] = [];
    for (
      let index = 0;
      index < MAX_EAGER_KNOWLEDGE_MAP_IMAGES + EXTRA_RASTER_ASSET_COUNT;
      index += 1
    ) {
      rasterAssets.push(asset({ readableId: `image-${index}` }));
    }
    const document = asset({ readableId: 'document', mediaType: 'application/pdf' });
    const layout = buildKnowledgeMapLayout([
      page({
        readableId: 'image-heavy-page',
        title: 'Image-heavy page',
        assetUsages: [...rasterAssets, document].map((mapAsset) => ({
          asset: mapAsset,
          presentation: 'embed',
        })),
      }),
    ]);

    const eagerImageKeys = eagerKnowledgeMapImageKeys(layout);

    expect(eagerImageKeys.size).toBe(MAX_EAGER_KNOWLEDGE_MAP_IMAGES);
    expect(eagerImageKeys.has('asset:document')).toBe(false);
  });
});
