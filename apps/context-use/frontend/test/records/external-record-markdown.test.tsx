import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ContextRecordMarkdown,
  externalRecordUrl,
} from '../../src/components/records/record-markdown';

describe('external record Markdown', () => {
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

test('renders local asset images and attachments while suppressing external and malformed image addresses', () => {
  const html = renderToStaticMarkup(
    <ContextRecordMarkdown
      label="Attachments"
      markdown={`![Diagram][image]

[Download](context-use://asset/notes)

[image]: context-use://asset/local-diagram

![External](https://tracker.example/pixel.png)

![Malformed](context-use://asset/../../private)`}
    />,
  );
  expect(html).toContain('src="/api/assets/local-diagram/content"');
  expect(html).toContain('href="/api/assets/notes/content"');
  expect(html).toContain('alt="Diagram"');
  expect(html).not.toContain('tracker.example');
  expect(html).not.toContain('../../private');
});
