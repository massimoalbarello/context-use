import { Elysia, StatusMap, t } from 'elysia';
import { ErrorResponseSchema, NotFoundError } from '#backend/lib/errors.ts';
import { isEmbeddableAssetMedia } from '#backend/models/assets/media.ts';
import { assetContentResponse } from '#backend/routes/asset-content-response.ts';
import { createPublicDiscoveryController } from '#backend/routes/public/discovery-controller.ts';
import { PUBLIC_DOCUMENT_CSP } from '#backend/routes/public/document.tsx';
import { publicEntityHtml } from '#backend/routes/public/entity.tsx';
import { publicEntityMarkdown } from '#backend/routes/public/markdown.ts';
import { publicPageHtml } from '#backend/routes/public/page.tsx';
import { publicRecordHtml } from '#backend/routes/public/record.tsx';
import { publicNotFound, publicReadingResponse } from '#backend/routes/public/response.tsx';
import type { PublicResourcesServiceContract } from '#backend/services/public-resources/service.ts';
import { emptyPublicHomepageHtml } from './homepage.tsx';

export function createPublicController({
  publicResourcesService,
  publicOrigin,
  siteName,
  ownerId,
}: {
  publicResourcesService: PublicResourcesServiceContract;
  publicOrigin: string;
  ownerId: string;
  siteName?: string;
}) {
  const readHomepage = async ({ request }: { request: Request }) => {
    const content = await publicResourcesService.homepageContent({ ownerId });
    const canonicalUrl = new URL('/', publicOrigin).href;
    return publicReadingResponse({
      request,
      canonicalUrl,
      markdownUrl: content ? `/public/pages/${content.publicId}/markdown` : undefined,
      html: () =>
        content
          ? publicPageHtml({ ...content, canonicalUrl, siteName })
          : emptyPublicHomepageHtml({ canonicalUrl, siteName }),
      markdown: () =>
        content?.markdown ??
        '# Nothing published yet\n\nThis knowledge base doesn’t have a public homepage yet. [Browse public content](/public/directory) or use the [AI-readable site index](/llms.txt).\n',
    });
  };
  return new Elysia()
    .use(createPublicDiscoveryController({ publicResourcesService, publicOrigin, siteName }))
    .onBeforeHandle(({ set }) => {
      set.headers['cache-control'] = 'private, no-store';
      set.headers['x-content-type-options'] = 'nosniff';
      set.headers['content-security-policy'] = PUBLIC_DOCUMENT_CSP;
      set.headers['referrer-policy'] = 'no-referrer';
    })
    .get('/', readHomepage, { detail: { hide: true } })
    .get('/public', readHomepage, {
      detail: { tags: ['Public site'], summary: 'Read the public homepage', security: [] },
    })
    .get(
      '/public/entities/:publicId',
      async ({ params, request }) => {
        const content = await publicResourcesService.entityContent({ publicId: params.publicId });
        if (!content) {
          return publicNotFound({ request });
        }
        const canonicalUrl = new URL(
          `/public/entities/${encodeURIComponent(params.publicId)}`,
          publicOrigin,
        ).href;
        return publicReadingResponse({
          request,
          canonicalUrl,
          markdownUrl: `${new URL(canonicalUrl).pathname}/markdown`,
          html: () =>
            publicEntityHtml({ ...content, publicId: params.publicId, canonicalUrl, siteName }),
          markdown: () => publicEntityMarkdown(content),
        });
      },
      {
        params: t.Object({ publicId: t.String() }),
        detail: { tags: ['Entities'], summary: 'Read an active public entity', security: [] },
        response: {
          [StatusMap.OK]: t.String(),
          [StatusMap['Not Found']]: t.Union([t.String(), ErrorResponseSchema]),
          [StatusMap['Not Acceptable']]: t.String(),
          [StatusMap['Internal Server Error']]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/public/pages/:publicId',
      async ({ params, request }) => {
        const content = await publicResourcesService.pageContent({ publicId: params.publicId });
        if (!content) {
          return publicNotFound({ request });
        }
        const canonicalUrl = new URL(
          `/public/pages/${encodeURIComponent(params.publicId)}`,
          publicOrigin,
        ).href;
        return publicReadingResponse({
          request,
          canonicalUrl,
          markdownUrl: `${new URL(canonicalUrl).pathname}/markdown`,
          html: () =>
            publicPageHtml({ publicId: params.publicId, ...content, canonicalUrl, siteName }),
          markdown: () => content.markdown,
        });
      },
      {
        params: t.Object({ publicId: t.String() }),
        detail: { tags: ['Pages'], summary: 'Read an active public page', security: [] },
        response: {
          [StatusMap.OK]: t.String(),
          [StatusMap['Not Found']]: t.Union([t.String(), ErrorResponseSchema]),
          [StatusMap['Not Acceptable']]: t.String(),
          [StatusMap['Internal Server Error']]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/public/pages/:publicId/markdown',
      async ({ params, request }) => {
        const content = await publicResourcesService.pageContent({ publicId: params.publicId });
        if (!content) {
          return publicNotFound({ request, markdown: true });
        }
        return new Response(content.markdown, {
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            link: '</llms.txt>; rel="describedby"',
          },
        });
      },
      {
        params: t.Object({ publicId: t.String() }),
        detail: {
          tags: ['Pages'],
          summary: 'Read safe Markdown for an active public page',
          security: [],
        },
        response: {
          [StatusMap.OK]: t.String(),
          [StatusMap['Not Found']]: t.Union([t.String(), ErrorResponseSchema]),
          [StatusMap['Internal Server Error']]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/public/entities/:publicId/markdown',
      async ({ params, request }) => {
        const content = await publicResourcesService.entityContent({ publicId: params.publicId });
        if (!content) {
          return publicNotFound({ request, markdown: true });
        }
        return new Response(publicEntityMarkdown(content), {
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            link: '</llms.txt>; rel="describedby"',
          },
        });
      },
      { params: t.Object({ publicId: t.String() }), detail: { hide: true } },
    )
    .get(
      '/public/records/:publicId',
      async ({ params }) => {
        const content = await publicResourcesService.recordContent({ publicId: params.publicId });
        if (!content) {
          throw new NotFoundError();
        }
        return new Response(publicRecordHtml({ publicId: params.publicId, ...content }), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      },
      {
        params: t.Object({ publicId: t.String() }),
        detail: { tags: ['Records'], summary: 'Read an active public record', security: [] },
        response: {
          [StatusMap.OK]: t.String(),
          [StatusMap['Not Found']]: ErrorResponseSchema,
          [StatusMap['Internal Server Error']]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/public/records/:publicId/markdown',
      async ({ params }) => {
        const content = await publicResourcesService.recordContent({ publicId: params.publicId });
        if (!content) {
          throw new NotFoundError();
        }
        return new Response(content.markdown, {
          headers: { 'content-type': 'text/markdown; charset=utf-8' },
        });
      },
      {
        params: t.Object({ publicId: t.String() }),
        detail: {
          tags: ['Records'],
          summary: 'Read safe Markdown for an active public record',
          security: [],
        },
        response: {
          [StatusMap.OK]: t.String(),
          [StatusMap['Not Found']]: ErrorResponseSchema,
          [StatusMap['Internal Server Error']]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/public/assets/:publicId',
      async ({ params }) => {
        const content = await publicResourcesService.assetContent({ publicId: params.publicId });
        if (!content) {
          throw new NotFoundError();
        }
        const response = assetContentResponse({
          asset: content.asset,
          blob: content.blob,
          inline: isEmbeddableAssetMedia(content.asset.mediaType),
        });
        response.headers.set('content-security-policy', "default-src 'none'; sandbox");
        return response;
      },
      {
        // Private and unknown identifiers must take the same not-found path.
        params: t.Object({ publicId: t.String() }),
        detail: { tags: ['Assets'], summary: 'Read an active public asset', security: [] },
        response: {
          [StatusMap.OK]: t.File(),
          [StatusMap['Not Found']]: t.Union([t.String(), ErrorResponseSchema]),
          [StatusMap['Internal Server Error']]: ErrorResponseSchema,
        },
      },
    )
    .get('/public/*', ({ request }) => publicNotFound({ request }), { detail: { hide: true } });
}
