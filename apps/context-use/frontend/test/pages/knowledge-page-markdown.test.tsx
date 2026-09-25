import { afterEach, describe, expect, test } from 'bun:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { publicPageMarkdown } from '#backend/models/public-resources/markdown.ts';
import { publicPageHtml } from '#backend/routes/public/page.tsx';
import {
  entityMentionFrom,
  KnowledgePageMarkdown,
  knowledgeHeadingId,
} from '../../src/components/pages/knowledge-page-markdown';

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

  test('derives readable anchors for linked page sections', () => {
    expect(knowledgeHeadingId('The Feedback Loop')).toBe('the-feedback-loop');
    expect(knowledgeHeadingId('Evidence, action & learning')).toBe('evidence-action-learning');
    expect(
      knowledgeHeadingId([
        'Café ',
        <strong key="bold">bold</strong>,
        ' and ',
        <code key="code">code</code>,
        ' ',
        <img key="image" alt="ignored alt" />,
      ]),
    ).toBe('cafe-bold-and-code');
    expect(knowledgeHeadingId(['The ', <em key="feedback">Feedback</em>, ' Loop'])).toBe(
      'the-feedback-loop',
    );
  });

  test('private and public heading anchors use visible Markdown without HTML, comments or attributes', () => {
    const source =
      '# Heading parity\n\n[Jump to section](#some-heading)\n\n## Some <em data-private="attribute-token">heading</em><!--comment-token-->\n\nVisible content.\n\n## Café **bold** and `code` ![ignored alt](https://example.com/tracker.png)';
    const markdown = publicPageMarkdown({ markdown: source, targets: [] });
    expect(markdown).not.toBeNull();
    const privateHtml = renderToStaticMarkup(<KnowledgePageMarkdown markdown={source} />);
    const publicHtml = publicPageHtml({
      publicId: '1822999b-37d0-4277-b578-697b704e6e27',
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

  test('renders the title as part of the Markdown document', () => {
    const html = renderToStaticMarkup(
      <KnowledgePageMarkdown markdown={'# Header page\n\nThe body remains visible.'} />,
    );

    expect(html).toContain('>Header page</h1>');
    expect(html).toContain('>The body remains visible.</p>');
  });

  test('renders asset embeds and attachments through authenticated content routes', () => {
    const html = renderToStaticMarkup(
      <KnowledgePageMarkdown
        markdown={
          '# Evidence\n\n![Quarterly chart](context-use://asset/quarterly-chart)\n\n[Download model](context-use://asset/financial-model)'
        }
      />,
    );

    expect(html).toContain('src="/api/assets/quarterly-chart/content"');
    expect(html).toContain('href="/api/assets/financial-model/content"');
  });

  test('resolves assigned images into entity mention chips', () => {
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    const mention = entityMentionFrom({
      readableId: 'alex-morgan',
      name: 'Alex Morgan',
      mentions: [
        {
          readableId: 'alex-morgan',
          name: 'Alex Morgan',
          image: {
            readableId: 'alex-morgan-image',
            name: 'Alex Morgan image',
            mediaType: 'image/png',
            extension: 'png',
            sizeBytes: 42,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      ],
    });

    expect(mention).toEqual(
      expect.objectContaining({
        image: expect.objectContaining({
          readableId: 'alex-morgan-image',
        }),
      }),
    );
  });
});
