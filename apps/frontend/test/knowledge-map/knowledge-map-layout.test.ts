import { describe, expect, test } from 'bun:test';
import {
  buildKnowledgeMapLayout,
  filterKnowledgeMapPages,
  pageCloudWords,
} from '../../src/components/knowledge-map/knowledge-map-layout';
import type { KnowledgeMapEntity, KnowledgeMapPage } from '../../src/queries/knowledge-map';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const MINIMUM_RESOURCE_DISTANCE = 116;
const CROWDED_NEIGHBOR_COUNT = 12;

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

function page({
  readableId,
  title,
  ...options
}: {
  readableId: string;
  title: string;
} & Partial<
  Pick<KnowledgeMapPage, 'excerpt' | 'mentions' | 'references' | 'assetUsages'>
>): KnowledgeMapPage {
  return {
    readableId,
    title,
    excerpt: options.excerpt ?? 'A focused account of the subject and its context.',
    temporalCoverage: null,
    revisionNumber: 1,
    createdAt,
    updatedAt: createdAt,
    mentions: options.mentions ?? [],
    references: options.references ?? [],
    assetUsages: options.assetUsages ?? [],
  };
}

describe('knowledge map layout', () => {
  test('keeps one shared entity dot inside both page clouds', () => {
    const sharedEntity = entity({ readableId: 'luca', name: 'Luca' });
    const first = page({ readableId: 'first-page', title: 'First page', mentions: [sharedEntity] });
    const second = page({
      readableId: 'second-page',
      title: 'Second page',
      mentions: [sharedEntity],
      references: [{ page: first, fragment: null }],
    });

    const layout = buildKnowledgeMapLayout([first, second]);

    expect(layout.resources).toHaveLength(1);
    expect(layout.resources[0]?.key).toBe('entity:luca');
    expect(layout.pages.every(({ cloudPath }) => cloudPath.length > 0)).toBe(true);
    expect(layout.pages.every(({ resourceKeys }) => resourceKeys.includes('entity:luca'))).toBe(
      true,
    );
    expect(layout.references).toHaveLength(1);
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
    for (const [index, resource] of layout.resources.entries()) {
      for (const other of layout.resources.slice(index + 1)) {
        expect(
          Math.hypot(resource.point.x - other.point.x, resource.point.y - other.point.y),
        ).toBeGreaterThanOrEqual(MINIMUM_RESOURCE_DISTANCE);
      }
    }
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

  test('uses meaningful excerpt terms without repeating title words', () => {
    expect(
      pageCloudWords({
        title: 'Growth playbook',
        excerpt: 'Growth comes from customer feedback, feedback, and deliberate experiments.',
      }),
    ).toEqual(['feedback', 'experiments', 'deliberate']);
  });
});
