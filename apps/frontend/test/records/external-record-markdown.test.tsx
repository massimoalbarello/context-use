import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ExternalRecordMarkdown,
  externalRecordUrl,
} from '../../src/components/records/external-record-markdown';

describe('external record Markdown', () => {
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
