import { Elysia, t } from 'elysia';
import type { PublicResourcesServiceContract } from '#backend/services/public-resources/service.ts';
import { PUBLIC_DOCUMENT_CSP } from './document.tsx';
import { publicIndexHtml } from './index.tsx';
import { publicIndexMarkdown, publicResourcePath } from './markdown.ts';
import { publicNotFound, publicReadingResponse } from './response.tsx';

const INDEX_SIZE = 50;
const SITEMAP_SIZE = 1_000;
const indexQuery = t.Object({
  page: t.Optional(t.Integer({ minimum: 1, maximum: 1_000_000, default: 1 })),
});

export function createPublicDiscoveryController({
  publicResourcesService,
  publicOrigin,
  siteName,
}: {
  publicResourcesService: PublicResourcesServiceContract;
  publicOrigin: string;
  siteName?: string;
}) {
  const url = (path: string) => new URL(path, publicOrigin).href;
  const xml = (body: string) =>
    new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
      headers: { 'content-type': 'application/xml; charset=utf-8' },
    });
  const loc = (path: string) => Bun.escapeHTML(url(path));
  const readIndex = async ({ query, request }: { query: { page?: number }; request: Request }) => {
    const page = query.page ?? 1;
    const index = await publicResourcesService.index({
      offset: (page - 1) * INDEX_SIZE,
      limit: INDEX_SIZE,
    });
    if (page > 1 && !index.entries.length) {
      return publicNotFound({ request });
    }
    const nextPage = page * INDEX_SIZE < index.total ? page + 1 : null;
    return publicReadingResponse({
      request,
      canonicalUrl: url(page === 1 ? '/public/directory' : `/public/directory?page=${page}`),
      markdownUrl: `/llms.txt?page=${page}`,
      html: () => publicIndexHtml({ ...index, page, nextPage, origin: publicOrigin, siteName }),
      markdown: () =>
        publicIndexMarkdown({
          ...index,
          nextUrl: nextPage ? `/llms.txt?page=${nextPage}` : null,
          origin: publicOrigin,
          siteName,
        }),
    });
  };
  return new Elysia()
    .onBeforeHandle(({ set }) => {
      set.headers['cache-control'] = 'private, no-store';
      set.headers['x-content-type-options'] = 'nosniff';
      set.headers['content-security-policy'] = PUBLIC_DOCUMENT_CSP;
      set.headers['referrer-policy'] = 'no-referrer';
    })
    .get('/public/directory', readIndex, { query: indexQuery, detail: { hide: true } })
    .get(
      '/llms.txt',
      async ({ query, request }) => {
        const page = query.page ?? 1;
        const index = await publicResourcesService.index({
          offset: (page - 1) * INDEX_SIZE,
          limit: INDEX_SIZE,
        });
        if (page > 1 && !index.entries.length) {
          return publicNotFound({ request, markdown: true });
        }
        return new Response(
          publicIndexMarkdown({
            ...index,
            nextUrl: page * INDEX_SIZE < index.total ? `/llms.txt?page=${page + 1}` : null,
            origin: publicOrigin,
            siteName,
          }),
          {
            headers: {
              'content-type': 'text/markdown; charset=utf-8',
              link: '</public/directory>; rel="alternate"; type="text/html"',
            },
          },
        );
      },
      { query: indexQuery, detail: { hide: true } },
    )
    .get(
      '/robots.txt',
      () =>
        new Response(
          `User-agent: *\nAllow: /public\nAllow: /$\nAllow: /llms.txt\nAllow: /sitemap.xml\nDisallow: /\n\nSitemap: ${url('/sitemap.xml')}\n`,
          {
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          },
        ),
      { detail: { hide: true } },
    )
    .get(
      '/sitemap.xml',
      async ({ query, request }) => {
        if (query.page === undefined) {
          const { total } = await publicResourcesService.index({ offset: 0, limit: 1 });
          const count = Math.max(1, Math.ceil(total / SITEMAP_SIZE));
          return xml(
            `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...Array(count).keys()].map((i) => `<sitemap><loc>${loc(`/sitemap.xml?page=${i + 1}`)}</loc></sitemap>`).join('')}</sitemapindex>`,
          );
        }
        const index = await publicResourcesService.index({
          offset: (query.page - 1) * SITEMAP_SIZE,
          limit: SITEMAP_SIZE,
        });
        if (query.page > 1 && !index.entries.length) {
          return publicNotFound({ request });
        }
        return xml(
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${loc('/')}</loc></url><url><loc>${loc('/public/directory')}</loc></url>${index.entries.map((entry) => `<url><loc>${loc(publicResourcePath(entry))}</loc><lastmod>${Bun.escapeHTML(entry.modifiedAt)}</lastmod></url>`).join('')}</urlset>`,
        );
      },
      {
        query: t.Object({ page: t.Optional(t.Integer({ minimum: 1, maximum: 50_000 })) }),
        detail: { hide: true },
      },
    );
}
