import { describe, expect, test } from 'bun:test';
import {
  buildKnowledgeMapLayout,
  eagerKnowledgeMapImageKeys,
  filterKnowledgeMapPages,
  MAX_EAGER_KNOWLEDGE_MAP_IMAGES,
  mapViewportNearBoundary,
} from '../../src/components/knowledge-map/knowledge-map-layout';
import type {
  KnowledgeMapAsset,
  KnowledgeMapBatch,
  KnowledgeMapEntity,
  KnowledgeMapPage,
} from '../../src/queries/knowledge-map';
import { knowledgeMapFrom } from '../../src/queries/knowledge-map';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const MINIMUM_RESOURCE_DISTANCE = 116;
const CROWDED_NEIGHBOR_COUNT = 12;
const EXTRA_RASTER_ASSET_COUNT = 4;

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
} & Partial<Pick<KnowledgeMapPage, 'excerpt' | 'mentions' | 'assetUsages'>>): KnowledgeMapPage {
  return {
    readableId,
    title,
    excerpt: options.excerpt ?? 'A focused account of the subject and its context.',
    temporalCoverage: null,
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

  test('merges cursor batches without duplicating a page at their boundary', () => {
    const first = page({ readableId: 'first', title: 'First' });
    const second = page({ readableId: 'second', title: 'Second' });
    const batches: KnowledgeMapBatch[] = [
      { pages: [first], totalPages: 2, nextCursor: 'next', truncated: false },
      { pages: [first, second], totalPages: 2, nextCursor: null, truncated: false },
    ];

    expect(knowledgeMapFrom(batches).pages.map(({ readableId }) => readableId)).toEqual([
      'first',
      'second',
    ]);
  });

  test('filters a neighborhood through page, entity, and asset preview text', () => {
    const pages = [
      page({
        readableId: 'people',
        title: 'People',
        mentions: [entity({ readableId: 'maya', name: 'Maya Chen' })],
      }),
      page({
        readableId: 'evidence',
        title: 'Evidence',
        assetUsages: [
          {
            asset: {
              readableId: 'chart',
              name: 'Quarterly chart',
              mediaType: 'image/png',
              extension: 'png',
              sizeBytes: 1200,
              createdAt,
              updatedAt: createdAt,
            },
            presentation: 'embed',
          },
        ],
      }),
    ];

    expect(
      filterKnowledgeMapPages({ pages, query: 'maya' }).map(({ readableId }) => readableId),
    ).toEqual(['people']);
    expect(
      filterKnowledgeMapPages({ pages, query: 'quarterly' }).map(({ readableId }) => readableId),
    ).toEqual(['evidence']);
    expect(filterKnowledgeMapPages({ pages, query: 'missing' })).toEqual([]);
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
