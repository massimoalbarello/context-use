import { Elysia, StatusMap, t } from 'elysia';
import { ErrorResponseSchema, NotFoundError } from '#backend/lib/errors.ts';
import { isEmbeddableAssetMedia } from '#backend/models/assets/media.ts';
import { assetContentResponse } from '#backend/routes/asset-content-response.ts';
import { PUBLIC_DOCUMENT_CSP } from '#backend/routes/public/document.tsx';
import { publicPageHtml } from '#backend/routes/public/page.tsx';
import type { PublicResourcesServiceContract } from '#backend/services/public-resources/service.ts';

export function createPublicController({
  publicResourcesService,
}: {
  publicResourcesService: PublicResourcesServiceContract;
}) {
  return new Elysia({ prefix: '/public' })
    .onBeforeHandle(({ set }) => {
      set.headers['cache-control'] = 'private, no-store';
      set.headers['x-content-type-options'] = 'nosniff';
      set.headers['content-security-policy'] = PUBLIC_DOCUMENT_CSP;
      set.headers['referrer-policy'] = 'no-referrer';
    })
    .get(
      '/pages/:publicId',
      async ({ params }) => {
        const content = await publicResourcesService.pageContent({ publicId: params.publicId });
        if (!content) {
          throw new NotFoundError();
        }
        return new Response(publicPageHtml({ publicId: params.publicId, ...content }), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      },
      {
        params: t.Object({ publicId: t.String() }),
        detail: { tags: ['Pages'], summary: 'Read an active public page', security: [] },
        response: {
          [StatusMap.OK]: t.String(),
          [StatusMap['Not Found']]: ErrorResponseSchema,
          [StatusMap['Internal Server Error']]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/pages/:publicId/markdown',
      async ({ params }) => {
        const content = await publicResourcesService.pageContent({ publicId: params.publicId });
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
          tags: ['Pages'],
          summary: 'Read safe Markdown for an active public page',
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
      '/assets/:publicId',
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
          [StatusMap['Not Found']]: ErrorResponseSchema,
          [StatusMap['Internal Server Error']]: ErrorResponseSchema,
        },
      },
    );
}
