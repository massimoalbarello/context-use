import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { visit } from 'unist-util-visit';
import { CHANGE, NOW, withPublicResources } from './fixture.ts';

test('the directory, AI index and sitemap expose approved public projections and remove withdrawn content', async () => {
  await withPublicResources(async (fixture) => {
    const { app, targets, create, update, publish, transition } = fixture;
    const target = await targets();
    await fixture.entities.update({
      ownerId: 'owner-a',
      readableId: target.entity.readableId,
      name: 'Entity </script><script>unsafe</script>',
      description: 'Public description',
      updatedAt: NOW,
      change: CHANGE,
    });
    const page = await create({ markdown: '# Shared [title] & <script>\n\nPublic body.' });
    const id = await publish({ readableId: page.readableId });
    const privatePage = await create({ markdown: '# SECRET never published\n\nPrivate body.' });
    const foreignPage = await create({
      ownerId: 'owner-b',
      markdown: '# Other owner public page\n\nPublic body.',
    });
    const foreignId = await transition({
      ownerId: 'owner-b',
      resourceType: 'page',
      action: 'publish',
      readableId: foreignPage.readableId,
      revisionNumber: 1,
    });
    await update({ readableId: page.readableId, markdown: '# SECRET next draft\n\nPrivate body.' });
    const snapshots = new Map<string, string>();
    for (const path of ['/public/directory', '/llms.txt', '/sitemap.xml?page=1']) {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(StatusMap.OK);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const body = await response.text();
      snapshots.set(path, body);
      expect(body).toContain(id);
      expect(body).toContain(foreignId);
      expect(body).toContain(target.entityId);
      for (const secret of [
        'SECRET',
        privatePage.readableId,
        page.readableId,
        foreignPage.readableId,
        'owner-a',
        'owner-b',
        'Private author name',
      ]) {
        expect(body).not.toContain(secret);
      }
      const withCookie = await app.handle(
        new Request(`http://localhost${path}`, {
          headers: { cookie: 'better-auth.session_token=owner-session' },
        }),
      );
      expect(await withCookie.text()).toBe(body);
    }
    expect(snapshots.get('/public/directory')).toContain('Shared [title] &amp;');
    expect(snapshots.get('/public/directory')).toContain(
      'Entity &lt;/script&gt;&lt;script&gt;unsafe&lt;/script&gt;',
    );
    expect(snapshots.get('/public/directory')).not.toContain('<script>');
    const entityUrl = `http://localhost/public/entities/${target.entityId}`;
    await assertHtmlDiscovery({
      body: await (await app.handle(new Request(entityUrl))).text(),
      canonicalUrl: entityUrl,
    });
    const urls: string[] = [];
    visit(fromMarkdown(snapshots.get('/llms.txt')!), 'link', (node) => {
      urls.push(node.url);
    });
    expect(urls).toContain(`http://localhost/public/pages/${id}/markdown`);
    expect(urls).toContain(`http://localhost/public/entities/${target.entityId}/markdown`);
    for (const url of urls) {
      expect((await app.handle(new Request(url))).status).toBe(StatusMap.OK);
    }
    expect(snapshots.get('/sitemap.xml?page=1')).toContain(`<lastmod>${page.updatedAt}</lastmod>`);
    await transition({
      ownerId: 'owner-a',
      resourceType: 'page',
      action: 'unpublish',
      readableId: page.readableId,
    });
    const { database } = fixture;
    await database`update "knowledge_page" set "archived_at" = ${NOW} where "id" = ${foreignPage.id}`;
    for (const path of snapshots.keys()) {
      const body = await (await app.handle(new Request(`http://localhost${path}`))).text();
      expect(body).not.toContain(id);
      expect(body).not.toContain(foreignId);
      expect(body).toContain(target.pageId);
    }
  });
});

test('canonical public URLs honor Accept preferences, exclusions and discovery links without changing approved content', async () => {
  await withPublicResources(async ({ app, targets }) => {
    const target = await targets();
    for (const [path, markdownUrl, canonicalPath] of [
      [
        `/public/pages/${target.pageId}`,
        `/public/pages/${target.pageId}/markdown`,
        `/public/pages/${target.pageId}`,
      ],
      [
        `/public/entities/${target.entityId}`,
        `/public/entities/${target.entityId}/markdown`,
        `/public/entities/${target.entityId}`,
      ],
      ['/public/directory', '/llms.txt', '/public/directory'],
    ] as const) {
      const markdown = await (
        await app.handle(new Request(`http://localhost${markdownUrl}`))
      ).text();
      for (const [accept, type, status] of [
        ['text/markdown', 'text/markdown', StatusMap.OK],
        ['text/html;q=0.2, text/markdown;q=0.9', 'text/markdown', StatusMap.OK],
        ['text/html;q=0, */*;q=0.5', 'text/markdown', StatusMap.OK],
        ['text/markdown;q=0, text/html', 'text/html', StatusMap.OK],
        ['*/*', 'text/html', StatusMap.OK],
        ['text/html', 'text/html', StatusMap.OK],
        ['application/json', 'text/plain', StatusMap['Not Acceptable']],
        ['text/html;q=0, text/markdown;q=0', 'text/plain', StatusMap['Not Acceptable']],
      ] as const) {
        const response = await app.handle(
          new Request(`http://localhost${path}`, { headers: { accept } }),
        );
        expect(response.status).toBe(status);
        expect(response.headers.get('content-type')).toBe(`${type}; charset=utf-8`);
        expect(response.headers.get('vary')).toContain('Accept');
        expect(response.headers.get('link')).toContain('</llms.txt>; rel="describedby"');
        const canonicalUrl = `http://localhost${canonicalPath}`;
        expect(response.headers.get('link')).toContain(canonicalUrl);
        const body = await response.text();
        if (type === 'text/markdown') {
          expect(body).toBe(markdown);
        }
        if (type === 'text/html') {
          await assertHtmlDiscovery({ body, canonicalUrl });
        }
      }
    }
  });
});

test('public discovery is bounded and all entries remain reachable through next-page links and sitemaps', async () => {
  await withPublicResources(async ({ app, create, publish }) => {
    const ids = [];
    const indexSize = 50;
    for (let i = 0; i < indexSize + 1; i++) {
      const page = await create({ markdown: `# Shared note ${i}\n\nBody.` });
      ids.push(await publish({ readableId: page.readableId }));
    }
    const first = await (await app.handle(new Request('http://localhost/public/directory'))).text();
    const second = await (
      await app.handle(new Request('http://localhost/public/directory?page=2'))
    ).text();
    expect(ids.filter((id) => first.includes(id))).toHaveLength(indexSize);
    expect(ids.filter((id) => second.includes(id))).toHaveLength(1);
    expect(first).toContain('href="/public/directory?page=2"');
    expect(second).toContain('href="/public/directory"');
    const llms = await (await app.handle(new Request('http://localhost/llms.txt'))).text();
    expect(llms).toContain('http://localhost/llms.txt?page=2');
    const sitemap = await (
      await app.handle(new Request('http://localhost/sitemap.xml?page=1'))
    ).text();
    for (const id of ids) {
      expect(sitemap).toContain(`/public/pages/${id}`);
    }
    for (const path of ['/public/directory?page=3', '/llms.txt?page=3', '/sitemap.xml?page=2']) {
      expect((await app.handle(new Request(`http://localhost${path}`))).status).toBe(
        StatusMap['Not Found'],
      );
    }
    for (const path of [
      '/public/directory?page=-1',
      '/llms.txt?page=1.5',
      '/sitemap.xml?page=nope',
    ]) {
      expect((await app.handle(new Request(`http://localhost${path}`))).status).toBe(
        StatusMap['Bad Request'],
      );
    }
  });
});

test('missing public resources have indistinguishable recoverable HTML and Markdown, and crawler policy covers public content', async () => {
  await withPublicResources(async ({ app, create }) => {
    const page = await create({ markdown: '# Private page\n\nSecret.' });
    for (const accept of ['text/html', 'text/markdown']) {
      const bodies = [];
      for (const path of [
        '/public/does-not-exist',
        '/public/pages/page_unknown',
        `/public/pages/${page.readableId}`,
        '/public/entities/entity_unknown',
      ]) {
        const response = await app.handle(
          new Request(`http://localhost${path}`, { headers: { accept } }),
        );
        expect(response.status).toBe(StatusMap['Not Found']);
        expect(response.headers.get('content-type')).toBe(`${accept}; charset=utf-8`);
        const body = await response.text();
        bodies.push(body);
        expect(body).toContain('/public/directory');
        expect(body).toContain('/llms.txt');
        expect(body).not.toContain(page.readableId);
      }
      expect(new Set(bodies).size).toBe(1);
    }
    const robots = await (await app.handle(new Request('http://localhost/robots.txt'))).text();
    expect(robots).toContain('User-agent: *\nAllow: /public');
    expect(robots).toContain('Disallow: /');
    expect(robots).toContain('Allow: /$');
    expect(robots).toContain('Sitemap: http://localhost/sitemap.xml');
    const sitemap = await (await app.handle(new Request('http://localhost/sitemap.xml'))).text();
    expect(sitemap).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(sitemap).toContain('<loc>http://localhost/sitemap.xml?page=1</loc>');
  });
});

async function assertHtmlDiscovery({ body, canonicalUrl }: { body: string; canonicalUrl: string }) {
  expect(body).toContain(`rel="canonical" href="${canonicalUrl}"`);
  expect(body).toContain('rel="alternate" type="text/markdown"');
  expect(body).toContain('AI-readable site index');
  const types: string[] = [];
  let metadata = '';
  await new HTMLRewriter()
    .on('script', {
      element(element) {
        types.push(element.getAttribute('type') ?? '');
      },
      text(text) {
        metadata += text.text;
      },
    })
    .transform(new Response(body))
    .text();
  expect(types).toEqual(['application/ld+json']);
  expect(JSON.parse(metadata)['@graph']).toContainEqual(
    expect.objectContaining({
      '@type': 'WebPage',
      url: canonicalUrl,
      isAccessibleForFree: true,
    }),
  );
}
