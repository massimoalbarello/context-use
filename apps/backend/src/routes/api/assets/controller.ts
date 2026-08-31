import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import {
  AssetListQuerySchema,
  AssetListSchema,
  AssetSchema,
  assetResponse,
  CreateAssetBodySchema,
} from '#routes/api/assets/model.ts';
import { assetSummaryResponse } from '#routes/api/assets/summary-model.ts';
import { DEFAULT_LIST_LIMIT, ResourceNameConflictSchema } from '#routes/api/model.ts';
import type { AssetsServiceContract } from '#services/assets/service.ts';

export function createAssetsController({
  auth,
  assetsService,
}: {
  auth: Auth;
  assetsService: AssetsServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: { [StatusMap.Unauthorized]: ErrorResponseSchema } })
    .post(
      '/assets',
      async ({ body, user, status }) => {
        const result = await assetsService.create({ ownerId: user.id, ...body });
        if (result.state === 'created') {
          return status(StatusMap.Created, assetResponse(result.asset));
        }
        if (result.state === 'name_conflict') {
          return status(StatusMap.Conflict, {
            error:
              'An asset with this name already exists. Use a more specific name or keep this name anyway.',
            nameConflict: true as const,
          });
        }
        return status(StatusMap['Bad Request'], { error: result.message });
      },
      {
        detail: { tags: ['Assets'], summary: 'Upload an asset' },
        body: CreateAssetBodySchema,
        response: {
          [StatusMap.Created]: AssetSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
          [StatusMap.Conflict]: ResourceNameConflictSchema,
        },
      },
    )
    .get(
      '/assets',
      async ({ query, user, status }) => {
        const page = await assetsService.list({
          ownerId: user.id,
          limit: query.limit ?? DEFAULT_LIST_LIMIT,
          offset: query.offset ?? 0,
          query: query.query,
        });
        return status(StatusMap.OK, { ...page, items: page.items.map(assetSummaryResponse) });
      },
      {
        detail: { tags: ['Assets'], summary: 'List active assets' },
        query: AssetListQuerySchema,
        response: { [StatusMap.OK]: AssetListSchema },
      },
    );
}
