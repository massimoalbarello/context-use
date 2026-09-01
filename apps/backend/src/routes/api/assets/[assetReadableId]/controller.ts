import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import {
  AssetContentQuerySchema,
  AssetParamsSchema,
  AssetResourceInUseResponseSchema,
  AssetSchema,
  assetResponse,
  assetUsageResponse,
  UpdateAssetBodySchema,
} from '#routes/api/assets/model.ts';
import type { AssetsServiceContract } from '#services/assets/service.ts';

function contentDisposition({
  name,
  extension,
  inline,
}: {
  name: string;
  extension: string | null;
  inline: boolean;
}): string {
  const filename = `${name}${extension ? `.${extension}` : ''}`;
  const fallback = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'asset';
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createAssetReadableIdController({
  auth,
  assetsService,
}: {
  auth: Auth;
  assetsService: AssetsServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: { [StatusMap.Unauthorized]: ErrorResponseSchema } })
    .get(
      '/assets/:assetReadableId',
      async ({ params, user, status }) => {
        const asset = await assetsService.detail({
          ownerId: user.id,
          readableId: params.assetReadableId,
        });
        return asset
          ? status(StatusMap.OK, assetResponse(asset))
          : status(StatusMap['Not Found'], { error: 'Asset not found' });
      },
      {
        detail: { tags: ['Assets'], summary: 'Read an asset and its usages' },
        params: AssetParamsSchema,
        response: { [StatusMap.OK]: AssetSchema, [StatusMap['Not Found']]: ErrorResponseSchema },
      },
    )
    .get(
      '/assets/:assetReadableId/content',
      async ({ params, query, user }) => {
        const content = await assetsService.content({
          ownerId: user.id,
          readableId: params.assetReadableId,
        });
        if (!content) {
          return new Response(JSON.stringify({ error: 'Asset not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(content.blob, {
          headers: {
            'content-type': content.asset.mediaType,
            'content-length': String(content.asset.sizeBytes),
            'content-disposition': contentDisposition({
              name: content.asset.name,
              extension: content.asset.extension,
              inline: query.download !== 'true',
            }),
            'x-content-type-options': 'nosniff',
            'cache-control': 'private, no-store',
          },
        });
      },
      {
        detail: { tags: ['Assets'], summary: 'Read verified asset bytes' },
        params: AssetParamsSchema,
        query: AssetContentQuerySchema,
      },
    )
    .put(
      '/assets/:assetReadableId',
      async ({ body, params, user, status }) => {
        const asset = await assetsService.updateName({
          ownerId: user.id,
          readableId: params.assetReadableId,
          name: body.name,
        });
        return asset
          ? status(StatusMap.OK, assetResponse(asset))
          : status(StatusMap['Not Found'], { error: 'Asset not found' });
      },
      {
        detail: { tags: ['Assets'], summary: 'Rename an asset' },
        params: AssetParamsSchema,
        body: UpdateAssetBodySchema,
        response: { [StatusMap.OK]: AssetSchema, [StatusMap['Not Found']]: ErrorResponseSchema },
      },
    )
    .put(
      '/assets/:assetReadableId/archive',
      async ({ params, user, status }) => {
        const result = await assetsService.archive({
          ownerId: user.id,
          readableId: params.assetReadableId,
        });
        if (result.state === 'resource_in_use') {
          return status(StatusMap.Conflict, {
            error: 'Asset is in use',
            blockers: result.blockers.map(assetUsageResponse),
          });
        }
        return result.state === 'archived'
          ? status(StatusMap['No Content'], undefined)
          : status(StatusMap['Not Found'], { error: 'Asset not found' });
      },
      {
        detail: { tags: ['Assets'], summary: 'Archive an unused asset' },
        params: AssetParamsSchema,
        response: {
          [StatusMap['No Content']]: t.Void(),
          [StatusMap['Not Found']]: ErrorResponseSchema,
          [StatusMap.Conflict]: AssetResourceInUseResponseSchema,
        },
      },
    );
}
