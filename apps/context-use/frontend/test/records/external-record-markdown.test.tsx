import { describe, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ContextRecordMarkdown,
  externalRecordUrl,
} from '../../src/components/records/record-markdown';
import { mockViewport } from '../support/viewport';

describe('external record Markdown', () => {
  test('previews a synced YouTube video and preserves playlist metadata without a duplicate source link', () => {
    const html = renderToStaticMarkup(
      <ContextRecordMarkdown
        label="Video title"
        markdown={`# Video title

Video: https://www.youtube.com/watch?v=Ut3LOjKNJaE

Channel: a16z

Playlist: Technology

Playlist URL: https://www.youtube.com/playlist?list=technology`}
      />,
    );
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/Ut3LOjKNJaE"');
    expect(html).toContain('title="YouTube video: Video title"');
    expect(html).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(html).not.toContain('href="https://www.youtube.com/watch?v=Ut3LOjKNJaE"');
    expect(html).not.toContain('Watch on YouTube');
    expect(html).toContain('Channel: a16z');
    expect(html).toContain('Playlist: Technology');
    expect(html.match(/<iframe/g)).toHaveLength(1);
  });

  test.each([
    'Video: https://www.youtube.com.evil.test/watch?v=Ut3LOjKNJaE',
    'Video: https://www.youtube.com@evil.test/watch?v=Ut3LOjKNJaE',
    'Video: http://www.youtube.com/watch?v=Ut3LOjKNJaE',
    'Video: https://www.youtube.com:444/watch?v=Ut3LOjKNJaE',
    'Video: https://www.youtube.com/playlist?list=Ut3LOjKNJaE',
    'Video: https://www.youtube.com/watch?v=invalid',
    'Video: https://www.youtube.com/watch?v=Ut3LOjKNJaE%2Fextra',
    'Video: not a URL',
    'Discuss https://www.youtube.com/watch?v=Ut3LOjKNJaE',
    '`Video: https://www.youtube.com/watch?v=Ut3LOjKNJaE`',
    '<iframe src="https://www.youtube.com/embed/Ut3LOjKNJaE"></iframe>',
  ])('does not embed unrelated, malformed, or untrusted video content: %s', (markdown) => {
    const html = renderToStaticMarkup(<ContextRecordMarkdown label="Record" markdown={markdown} />);
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('youtube-nocookie.com');
  });

  test('omits a repeated leading title while retaining distinct and later headings', () => {
    const html = renderToStaticMarkup(
      <ContextRecordMarkdown
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
      <ContextRecordMarkdown
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

test('renders local asset images and attachments while suppressing external and malformed image addresses', async () => {
  const viewport = mockViewport();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        readableId: 'local-diagram',
        name: 'Diagram',
        mediaType: 'image/png',
        sizeBytes: 100,
        extension: 'png',
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  );
  try {
    const view = render(
      <QueryClientProvider client={client}>
        <ContextRecordMarkdown
          label="Attachments"
          markdown={`![Diagram][image]{size=large align=center}

[Download](context-use://asset/notes)

[image]: context-use://asset/local-diagram

![External](https://tracker.example/pixel.png)

![Malformed](context-use://asset/../../private)`}
        />
      </QueryClientProvider>,
    );
    await screen.findByRole('img', { name: 'Diagram' });
    const html = view.container.innerHTML;
    expect(html).toContain('src="/api/assets/local-diagram/content"');
    expect(html).toContain('href="/api/assets/notes/content"');
    expect(html).toContain('alt="Diagram"');
    expect(html).not.toContain('tracker.example');
    expect(html).not.toContain('../../private');
    expect(html).not.toContain('{size=large align=center}');
  } finally {
    cleanup();
    client.clear();
    fetch.mockRestore();
    viewport.restore();
  }
});
