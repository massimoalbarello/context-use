import { describe, expect, test } from 'bun:test';
import {
  buildHypermediaLayout,
  type HypermediaLayoutResource,
} from '../../src/components/hypermedia/hypermedia-layout';
import {
  displayedHypermediaResourceKindsValue,
  filterHypermedia,
  toggleDisplayedHypermediaResourceKind,
} from '../../src/components/hypermedia/hypermedia-resource-filter';
import { buildTemporalHypermediaLayout } from '../../src/components/hypermedia/hypermedia-temporal-layout';
import {
  type HypermediaPage,
  hypermediaPagesQueryOptions,
  hypermediaResourceNeighborhoodQueryOptions,
} from '../../src/queries/hypermedia';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const resources: HypermediaLayoutResource[] = [
  {
    key: 'entity:owner',
    kind: 'entity',
    entity: {
      readableId: 'owner',
      name: 'Owner',
      description: 'The owner.',
      isSelf: true,
      image: null,
      createdAt,
      updatedAt: createdAt,
    },
    point: { x: 0, y: 0 },
  },
  {
    key: 'asset:plan',
    kind: 'asset',
    asset: {
      readableId: 'plan',
      name: 'Plan',
      mediaType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: 42,
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
    { kind: 'asset', readableId: 'plan' },
  ],
};

describe('Hypermedia resource type filter', () => {
  test('supports either resource type or both while retaining one selection', () => {
    const both = toggleDisplayedHypermediaResourceKind({ kinds: ['entity'], kind: 'asset' });
    const assets = toggleDisplayedHypermediaResourceKind({ kinds: both, kind: 'entity' });

    expect(both).toEqual(['entity', 'asset']);
    expect(displayedHypermediaResourceKindsValue(both)).toBe('all');
    expect(assets).toEqual(['asset']);
    expect(displayedHypermediaResourceKindsValue(assets)).toBe('assets');
    expect(toggleDisplayedHypermediaResourceKind({ kinds: assets, kind: 'asset' })).toBe(assets);
  });

  test('removes hidden resource nodes and page connections from both views', () => {
    const filtered = filterHypermedia({
      resources,
      pages: [page],
      kinds: ['entity'],
    });
    const map = buildHypermediaLayout(filtered.resources, filtered.pages);
    const timeline = buildTemporalHypermediaLayout({
      ...filtered,
      extent: {
        start: Date.parse('2026-01-01T00:00:00.000Z'),
        end: Date.parse('2026-12-31T00:00:00.000Z'),
      },
    });

    expect(map.resources.map(({ key }) => key)).toEqual(['entity:owner']);
    expect(map.pages[0]?.resourceKeys).toEqual(['entity:owner']);
    expect(timeline.resources.map(({ key }) => key)).toEqual(['entity:owner']);
    expect(timeline.pages[0]?.resourceKeys).toEqual(['entity:owner']);
  });

  test('keeps only keyword-matching resource nodes and connections in both views', () => {
    const filtered = filterHypermedia({
      resources,
      pages: [page],
      kinds: ['entity', 'asset'],
      query: 'the OWNER',
    });
    const map = buildHypermediaLayout(filtered.resources, filtered.pages);
    const timeline = buildTemporalHypermediaLayout({
      ...filtered,
      extent: {
        start: Date.parse('2026-01-01T00:00:00.000Z'),
        end: Date.parse('2026-12-31T00:00:00.000Z'),
      },
    });

    expect(map.resources.map(({ key }) => key)).toEqual(['entity:owner']);
    expect(map.pages[0]?.resourceKeys).toEqual(['entity:owner']);
    expect(timeline.resources.map(({ key }) => key)).toEqual(['entity:owner']);
    expect(timeline.pages[0]?.resourceKeys).toEqual(['entity:owner']);

    const cleared = filterHypermedia({
      resources,
      pages: [page],
      kinds: ['entity', 'asset'],
      query: '  ',
    });
    expect(cleared.resources).toEqual(resources);
    expect(cleared.pages[0]).toBe(page);
  });

  test('separates cached API results by selected resource kinds', () => {
    const entityNeighborhood = hypermediaResourceNeighborhoodQueryOptions({
      anchor: { kind: 'entity', readableId: 'owner' },
      kinds: ['entity'],
    });
    const assetNeighborhood = hypermediaResourceNeighborhoodQueryOptions({
      anchor: { kind: 'entity', readableId: 'owner' },
      kinds: ['asset'],
    });
    const entityPages = hypermediaPagesQueryOptions({
      layer: 'undated',
      resources: [],
      visibleResources: [],
      kinds: ['entity'],
    });
    const allPages = hypermediaPagesQueryOptions({
      layer: 'undated',
      resources: [],
      visibleResources: [],
      kinds: ['entity', 'asset'],
    });

    expect(entityNeighborhood.queryKey).not.toEqual(assetNeighborhood.queryKey);
    expect(entityPages.queryKey).not.toEqual(allPages.queryKey);
  });
});
