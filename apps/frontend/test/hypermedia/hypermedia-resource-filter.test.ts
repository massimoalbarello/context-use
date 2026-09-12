import { describe, expect, test } from 'bun:test';
import { keepPreviousData } from '@tanstack/react-query';
import {
  buildHypermediaLayout,
  type HypermediaLayoutResource,
} from '../../src/components/hypermedia/hypermedia-layout';
import { filterHypermedia } from '../../src/components/hypermedia/hypermedia-resource-filter';
import { type HypermediaPage, hypermediaPagesQueryOptions } from '../../src/queries/hypermedia';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const resources: HypermediaLayoutResource[] = [
  {
    key: 'entity:owner',
    kind: 'entity',
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
    kind: 'entity',
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
  resources: [
    { kind: 'entity', readableId: 'owner' },
    { kind: 'entity', readableId: 'plan' },
  ],
};

describe('Hypermedia search filter', () => {
  test('preserves server-selected matches without re-matching display text in the map', () => {
    const filtered = filterHypermedia({
      resources,
      pages: [page],
      matchingResourceKeys: new Set(['entity:owner']),
    });
    const map = buildHypermediaLayout(filtered.resources, filtered.pages);

    expect(map.resources.map(({ key }) => key)).toEqual(['entity:owner']);
    expect(map.pages[0]?.resourceKeys).toEqual(['entity:owner']);

    const cleared = filterHypermedia({
      resources,
      pages: [page],
    });
    expect(cleared.resources).toEqual(resources);
    expect(cleared.pages[0]).toBe(page);

    const noMatches = filterHypermedia({
      resources,
      pages: [page],
      matchingResourceKeys: new Set(),
    });
    expect(noMatches.resources).toEqual([]);
    expect(noMatches.pages[0]?.resources).toEqual([]);
  });

  test('retains the displayed page set while a changed interval loads', () => {
    const pages = hypermediaPagesQueryOptions({
      resources: [],
      visibleResources: [],
      month: '2026-09',
    });

    expect(pages.placeholderData).toBe(keepPreviousData);
  });
});
