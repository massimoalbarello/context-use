import { describe, expect, test } from 'bun:test';
import { keepPreviousData } from '@tanstack/react-query';
import { filterHypermedia } from '../../src/components/hypermedia/hypermedia-entity-filter';
import {
  buildHypermediaLayout,
  type HypermediaLayoutEntity,
} from '../../src/components/hypermedia/hypermedia-layout';
import { type HypermediaPage, hypermediaPagesQueryOptions } from '../../src/queries/hypermedia';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const entities: HypermediaLayoutEntity[] = [
  {
    key: 'entity:owner',
    entity: {
      readableId: 'owner',
      name: 'Owner',
      description: 'The owner.',
      entityType: null,
      isSelf: true,
      image: null,
      createdAt,
      updatedAt: createdAt,
    },
    point: { x: 0, y: 0 },
  },
  {
    key: 'entity:plan',
    entity: {
      readableId: 'plan',
      name: 'Plan',
      description: 'Planning team',
      entityType: null,
      isSelf: false,
      image: null,
      createdAt,
      updatedAt: createdAt,
    },
    point: { x: 200, y: 0 },
  },
];
const page: HypermediaPage = {
  readableId: 'planning',
  title: 'Planning',
  excerpt: 'A planning page.',
  temporalCoverage: '2026',
  revisionNumber: 1,
  createdAt,
  updatedAt: createdAt,
  entities: [{ readableId: 'owner' }, { readableId: 'plan' }],
};

describe('Hypermedia search filter', () => {
  test('preserves server-selected matches without re-matching display text in the map', () => {
    const filtered = filterHypermedia({
      entities,
      pages: [page],
      matchingEntityKeys: new Set(['entity:owner']),
    });
    const map = buildHypermediaLayout(filtered.entities, filtered.pages);

    expect(map.entities.map(({ key }) => key)).toEqual(['entity:owner']);
    expect(map.pages[0]?.entityKeys).toEqual(['entity:owner']);

    const cleared = filterHypermedia({
      entities,
      pages: [page],
    });
    expect(cleared.entities).toEqual(entities);
    expect(cleared.pages[0]).toBe(page);

    const noMatches = filterHypermedia({
      entities,
      pages: [page],
      matchingEntityKeys: new Set(),
    });
    expect(noMatches.entities).toEqual([]);
    expect(noMatches.pages[0]?.entities).toEqual([]);
  });

  test('retains the displayed page set while a changed interval loads', () => {
    const pages = hypermediaPagesQueryOptions({
      entities: [],
      visibleEntities: [],
      month: '2026-09',
    });

    expect(pages.placeholderData).toBe(keepPreviousData);
  });
});
