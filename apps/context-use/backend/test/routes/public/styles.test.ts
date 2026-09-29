import { expect, test } from 'bun:test';
import { PUBLIC_DOCUMENT_CSP } from '#backend/routes/public/document.tsx';
import { publicPageHtml } from '#backend/routes/public/page.tsx';

test('public documents embed compiled component styles authorized by CSP without client scripts', () => {
  const html = publicPageHtml({
    title: 'Static reading',
    markdown:
      '# Static reading\n\n[Person](/public/entities/person) [Website](https://example.com)',
    modifiedAt: '2026-09-29T00:00:00.000Z',
    mentions: {
      '/public/entities/person': { name: 'Person', imageUrl: '/public/assets/portrait' },
    },
  });
  const styles = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  expect(styles).toBeDefined();
  expect(PUBLIC_DOCUMENT_CSP).toContain(
    `style-src 'sha256-${new Bun.CryptoHasher('sha256').update(styles!).digest('base64')}'`,
  );
  expect(styles).not.toMatch(/@(import|tailwind|theme|source|apply)\b/);
  expect(styles).toContain('.sr-only');
  expect(styles).toContain('.bg-muted');
  expect(styles).toContain('prefers-color-scheme:dark');
  expect(html).toContain('src="/public/assets/portrait"');
  expect(html).not.toContain('<script');
  expect(PUBLIC_DOCUMENT_CSP).toContain("script-src 'none'");
  expect(PUBLIC_DOCUMENT_CSP).toContain('allow-scripts');
  expect(html).not.toContain('rel="stylesheet"');
});
