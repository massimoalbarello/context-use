import { Elysia, StatusMap, t } from 'elysia';
import { ErrorResponseSchema, NotFoundError } from '#backend/lib/errors.ts';
import { isEmbeddableAssetMedia } from '#backend/models/assets/media.ts';
import { assetContentResponse } from '#backend/routes/asset-content-response.ts';
import type { PublicResourcesServiceContract } from '#backend/services/public-resources/service.ts';

export function createPublicController({
  publicResourcesService,
}: {
  publicResourcesService: PublicResourcesServiceContract;
}) {
  return new Elysia({ prefix: '/public' }).get(
    '/assets/:publicId',
    async ({ params, set }) => {
      set.headers['cache-control'] = 'private, no-store';
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
