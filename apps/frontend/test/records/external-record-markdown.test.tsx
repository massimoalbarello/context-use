import { afterEach, describe, expect, test } from 'bun:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ExternalRecordMarkdown,
  externalRecordUrl,
} from '../../src/components/records/external-record-markdown';
import type { AssetSummary } from '../../src/queries/assets';

describe('external record Markdown', () => {
  test('omits a repeated leading title while retaining distinct and later headings', () => {
    const html = renderToStaticMarkup(
      <ExternalRecordMarkdown
        label="Record title"
        markdown={'# Record title\n\nBody\n\n# Record title\n\n# Another heading'}
      />,
    );
    expect(html).not.toContain('<h1');
    expect(html.match(/<h2/g)).toHaveLength(2);
    expect(html).toContain('Another heading');
    expect(html).toContain('Body');
  });

  test('activates only absolute HTTP links', () => {
    expect(externalRecordUrl('https://github.com/example/repository/pull/1')).toBe(
      'https://github.com/example/repository/pull/1',
    );
    expect(externalRecordUrl('http://example.test/source')).toBe('http://example.test/source');
    expect(externalRecordUrl('javascript:alert(1)')).toBe('');
    expect(externalRecordUrl('context-use://page/private-page')).toBe('');
    expect(externalRecordUrl('/api/assets/private/content')).toBe('');
  });

  test('does not activate raw HTML, images, or unsafe links', () => {
    const html = renderToStaticMarkup(
      <ExternalRecordMarkdown
        label="Delivered record"
        markdown={`# Delivered record

<script>alert('no')</script>

![Tracking pixel](https://tracker.example/pixel.png)

[Source](https://github.com/example/repository/pull/1)

[Unsafe](javascript:alert(1))

[Internal](context-use://page/private-page)`}
      />,
    );

    expect(html).toContain('Delivered record');
    expect(html).toContain('aria-label="Delivered record"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain("alert('no')");
    expect(html).not.toContain('<img');
    expect(html).not.toContain('tracker.example');
    expect(html).toContain('Image: Tracking pixel');
    expect(html).toContain('href="https://github.com/example/repository/pull/1"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="context-use:');
  });
});

afterEach(cleanup);

test('record attachments use authenticated assets and only declared images are embedded', async () => {
  const asset: AssetSummary = {
    readableId: 'drawing',
    name: 'drawing.png',
    mediaType: 'image/png',
    extension: 'png',
    sizeBytes: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const root = createRootRoute({ component: Outlet });
  const source = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <ExternalRecordMarkdown
        label="Mail"
        assets={[asset]}
        markdown={
          '[Drawing](context-use://asset/drawing)\n\n![Inline drawing](context-use://asset/drawing)\n\n[Unknown](context-use://asset/private)\n\n![Remote tracker](https://tracker.example/pixel.png)\n\n![Unlisted](context-use://asset/private)'
        }
      />
    ),
  });
  const target = createRoute({
    getParentRoute: () => root,
    path: '/assets/$id',
    component: () => <h1>Drawing detail</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([source, target]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  expect(screen.getByRole('img', { name: 'Inline drawing' }).getAttribute('src')).toBe(
    '/api/assets/drawing/content',
  );
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(screen.queryByRole('link', { name: 'Unknown' })).toBeNull();
  const link = screen.getByRole('link', { name: 'Drawing' });
  expect(link.getAttribute('href')).toBe('/assets/drawing');
  await userEvent.setup().click(link);
  expect(await screen.findByRole('heading', { name: 'Drawing detail' })).toBeTruthy();
});
