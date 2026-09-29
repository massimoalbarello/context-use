import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { publicPageMarkdown } from '#backend/models/public-resources/markdown.ts';
import { publicPageHtml } from '#backend/routes/public/page.tsx';
import { KnowledgePageMarkdown } from '../../src/components/pages/knowledge-page-markdown';

afterEach(cleanup);

describe('knowledge page Markdown', () => {
  test('keeps a link focused across refreshes while updating entity and record information', async () => {
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    await router.load();
    function Reader({ name = 'Alex Morgan', available = true }) {
      return (
        <RouterContextProvider router={router}>
          <KnowledgePageMarkdown
            markdown={
              '# Evidence\n\n[Alex](context-use://entity/alex-morgan) read the [source](context-use://record/source-record).'
            }
            mentions={[{ readableId: 'alex-morgan', name, image: null }]}
            recordReferences={[{ readableId: 'source-record', available }]}
          />
        </RouterContextProvider>
      );
    }
    const { rerender } = render(<Reader />);
    const link = screen.getByRole('link', { name: 'Alex' });
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(link);
    expect(within(link).getByText('A')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'source' })).toBeTruthy();

    rerender(<Reader />);
    expect(screen.getByRole('link', { name: 'Alex' })).toBe(link);
    expect(document.activeElement).toBe(link);

    rerender(<Reader name="Bailey Morgan" available={false} />);
    expect(screen.getByRole('link', { name: 'Alex' })).toBe(link);
    expect(document.activeElement).toBe(link);
    expect(within(link).getByText('B')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'source' })).toBeNull();
    expect(screen.getByText('(record unavailable)')).toBeTruthy();

    rerender(<Reader name="Bailey Morgan" />);
    expect(document.activeElement).toBe(link);
    expect(screen.getByRole('link', { name: 'source' })).toBeTruthy();
    expect(screen.queryByText('(record unavailable)')).toBeNull();
  });

  test('private and public heading anchors use visible Markdown without HTML, comments or attributes', () => {
    const source =
      '# Heading parity\n\n[Jump to section](#some-heading)\n\n## Some <em data-private="attribute-token">heading</em><!--comment-token-->\n\nVisible content.\n\n## Café **bold** and `code` ![ignored alt](https://example.com/tracker.png)';
    const markdown = publicPageMarkdown({ markdown: source, targets: [] });
    expect(markdown).not.toBeNull();
    const privateHtml = renderToStaticMarkup(<KnowledgePageMarkdown markdown={source} />);
    const publicHtml = publicPageHtml({
      publicId: 'page_parity',
      canonicalUrl: 'https://example.com/public/pages/page_parity',
      modifiedAt: '2026-09-25T00:00:00.000Z',
      title: 'Heading parity',
      markdown: markdown!,
    });
    const headingIds = (html: string) =>
      [...html.matchAll(/<h2[^>]*id="([^"]*)"/g)].map((match) => match[1]);
    expect(headingIds(privateHtml)).toEqual(['some-heading', 'cafe-bold-and-code']);
    expect(headingIds(publicHtml)).toEqual(headingIds(privateHtml));
    for (const html of [privateHtml, publicHtml]) {
      expect(html).toContain('href="#some-heading"');
      expect(html).not.toContain('attribute-token');
      expect(html).not.toContain('comment-token');
      expect(html).not.toContain('data-private');
      expect(html).not.toContain('some-em');
    }
    expect(markdown).toContain('[Jump to section](#some-heading)');
    expect(markdown).not.toContain('attribute-token');
    expect(markdown).not.toContain('comment-token');
    expect(markdown).not.toContain('<em');
  });

  test('renders asset media by metadata, consumes layout hints, and keeps failed media actionable', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        (input: Parameters<typeof globalThis.fetch>[0]) => {
          const url = String(input instanceof Request ? input.url : input);
          const readableId = url.split('/').at(-2)!;
          const mediaTypes: Record<string, string> = {
            chart: 'image/png',
            film: 'video/mp4',
            audio: 'audio/aac',
          };
          return Promise.resolve(
            new Response(
              JSON.stringify({
                readableId,
                name: readableId,
                mediaType: mediaTypes[readableId],
                extension: null,
                sizeBytes: 100,
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          );
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    try {
      render(
        <QueryClientProvider client={client}>
          <KnowledgePageMarkdown
            markdown={
              '# Evidence\n\n![Chart](context-use://asset/chart){layout=half}\n![Film](context-use://asset/film){layout=half}\n\n![Centered][chart]{size=large align=center}\n\n![Soundtrack](context-use://asset/audio)\n\n[chart]: context-use://asset/chart\n\n[Download model](context-use://asset/financial-model)\n\n`{size=large align=center}`\n\n[![Linked image](context-use://asset/chart){size=small}](https://example.com)'
            }
          />
        </QueryClientProvider>,
      );
      const linkedImage = await screen.findByRole('img', { name: 'Linked image' });
      expect(linkedImage.closest('a')?.getAttribute('href')).toBe('https://example.com');
      expect(linkedImage.closest('a')?.querySelector('a')).toBeNull();
      const image = await screen.findByRole('img', { name: 'Chart' });
      const video = await screen.findByLabelText('Film');
      expect(image.getAttribute('src')).toBe('/api/assets/chart/content');
      expect(video.tagName).toBe('VIDEO');
      expect(video.getAttribute('src')).toBe('/api/assets/film/content');
      expect(video.hasAttribute('controls')).toBe(true);
      expect(screen.queryByText('Chart')).toBeNull();
      expect(screen.queryByText('Film')).toBeNull();
      await waitFor(() => expect(screen.queryAllByRole('status')).toHaveLength(0));
      expect(screen.queryByLabelText('Soundtrack')).toBeNull();
      expect(screen.queryByText('Soundtrack')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Open asset' })).toBeNull();
      expect(screen.queryByText('{layout=half}')).toBeNull();
      expect(screen.getAllByText('{size=large align=center}')).toHaveLength(1);
      expect(screen.getByRole('link', { name: 'Download model' }).getAttribute('href')).toBe(
        '/api/assets/financial-model/content',
      );
      fireEvent.error(video);
      expect(screen.getByText('This file could not be previewed.')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Open asset' }).getAttribute('href')).toBe(
        '/api/assets/film/content',
      );
    } finally {
      cleanup();
      client.clear();
      fetch.mockRestore();
    }
  });

  test('shows an unavailable asset without a broken image when its metadata cannot load', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Asset not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      render(
        <QueryClientProvider client={client}>
          <KnowledgePageMarkdown markdown="# Missing\n\n![Missing asset](context-use://asset/missing){size=large align=center}" />
        </QueryClientProvider>,
      );
      expect(await screen.findByText('This asset is unavailable.')).toBeTruthy();
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.getByRole('link', { name: 'Open asset' })).toBeTruthy();
      expect(screen.queryByText('{size=large align=center}')).toBeNull();
    } finally {
      cleanup();
      client.clear();
      fetch.mockRestore();
    }
  });
});
