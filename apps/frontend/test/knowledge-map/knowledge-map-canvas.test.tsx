import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  KnowledgeMapCanvas,
  mapPointerEndAction,
} from '../../src/components/knowledge-map/knowledge-map-canvas';
import type {
  KnowledgeMapAsset,
  KnowledgeMapEntity,
  KnowledgeMapPage,
} from '../../src/queries/knowledge-map';

const createdAt = new Date('2026-01-01T00:00:00.000Z');

const self: KnowledgeMapEntity = {
  readableId: 'alex',
  name: 'Alex',
  description: 'The workspace owner.',
  isSelf: true,
  image: null,
  createdAt,
  updatedAt: createdAt,
};

const asset: KnowledgeMapAsset = {
  readableId: 'rollout-metrics',
  name: 'Rollout metrics',
  mediaType: 'application/octet-stream',
  extension: null,
  sizeBytes: 105,
  createdAt,
  updatedAt: createdAt,
};

const page: KnowledgeMapPage = {
  readableId: 'connected-page',
  title: 'Connected page',
  excerpt: 'A page connected to the owner.',
  temporalCoverage: null,
  revisionNumber: 1,
  createdAt,
  updatedAt: createdAt,
  mentions: [self],
  assetUsages: [{ asset, presentation: 'attachment' }],
};

test('the hypermedia canvas exposes page regions, circular entities, and rounded-square assets', () => {
  const html = renderToStaticMarkup(
    <KnowledgeMapCanvas
      pages={[page]}
      anchorEntity={self}
      onSelect={() => undefined}
      hasNextPage
      isFetchingNextPage={false}
      loadMoreError={null}
      onLoadMore={() => Promise.resolve()}
    />,
  );

  expect(html).toContain('aria-label="Interactive hypermedia map"');
  expect(html).toContain('data-map-cloud="connected-page"');
  expect(html).toContain('stroke-width="4"');
  expect(html).toContain('>A</text>');
  expect(html).toContain('aria-label="Open asset Rollout metrics"');
  expect(html).toContain('<circle');
  expect(html).toContain('<rect');
});

test('a cloud click selects its page while a boundary drag loads without selecting', () => {
  expect(
    mapPointerEndAction({
      moved: false,
      cloudReadableId: 'connected-page',
      canLoadMore: true,
      nearBoundary: true,
    }),
  ).toEqual({
    selectedPageReadableId: 'connected-page',
    suppressCloudClick: true,
    loadMore: false,
  });
  expect(
    mapPointerEndAction({
      moved: true,
      cloudReadableId: 'connected-page',
      canLoadMore: true,
      nearBoundary: true,
    }),
  ).toEqual({ selectedPageReadableId: undefined, suppressCloudClick: true, loadMore: true });
});
